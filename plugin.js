import path from 'path';
import mkdirp from 'mkdirp';
import ConcurrentQueue from './concurrent-queue';
import fs from 'fs';
import { APIClient, core } from 'fulcrum';
import request from 'request';
import rimraf from 'rimraf';

const { log, warn, error } = fulcrum.logger.withContext('media');

export default class {
  async task(cli) {
    return cli.command({
      command: 'media',
      desc: 'download media',
      builder: {
        org: {
          desc: 'organization name',
          required: true,
          type: 'string'
        },
        mediaPath: {
          desc: 'media storage directory',
          type: 'string'
        },
        mediaConcurrency: {
          desc: 'concurrent downloads (between 1 and 10)',
          type: 'number'
        }
      },
      handler: this.runCommand
    });
  }

  runCommand = async () => {
    await this.activate();

    const account = this.account = await fulcrum.fetchAccount(fulcrum.args.org);

    if (account) {
      const concurrency = Math.min(Math.max(1, fulcrum.args.mediaConcurrency || 5), 10);

      this.queue = new ConcurrentQueue(this.worker, concurrency);

      await this.queueMediaDownload(account, 'photos', 'photo');
      await this.queueMediaDownload(account, 'signatures', 'signature');
      await this.queueMediaDownload(account, 'audio', 'audio');
      await this.queueMediaDownload(account, 'videos', 'video');

      await this.queue.drain();
    } else {
      error('Unable to find account', fulcrum.args.org);
    }
  }

  async activate() {
    this.mediaPath = fulcrum.args.mediaPath || fulcrum.dir('media');

    mkdirp.sync(this.mediaPath);
    mkdirp.sync(path.join(this.mediaPath, 'photos'));
    mkdirp.sync(path.join(this.mediaPath, 'videos'));
    mkdirp.sync(path.join(this.mediaPath, 'audio'));
    mkdirp.sync(path.join(this.mediaPath, 'signatures'));

    // fulcrum.on('form:save', this.onFormSave);
    // fulcrum.on('records:finish', this.onRecordsFinished);
  }

  async deactivate() {
  }

  worker = async (task) => {
    try {
      const url = {
        photo: APIClient.getPhotoURL,
        video: APIClient.getVideoURL,
        audio: APIClient.getAudioURL,
        signature: APIClient.getSignatureURL
      }[task.type].bind(APIClient)({token: task.token}, task);

      const extension = {
        photo: 'jpg',
        video: 'mp4',
        audio: 'm4a',
        signature: 'png'
      }[task.type];

      const outputFileName = path.join(this.mediaPath, task.table, task.id + '.' + extension);

      if (task.track) {
        this.writeTracks(task.id, task.table, task.track);
      }

      let success = true;

      if (!fs.existsSync(outputFileName) || fs.statSync(outputFileName).size < 10) {
        try {
          log('Downloading', task.type, task.id);

          const outputName = await this.downloadWithRetries(url, outputFileName);

          if (outputName == null) {
            log('Not Found', url);
            rimraf.sync(outputFileName);
            success = false;
          }
        } catch (ex) {
          log(ex);
          success = false;
        }
      }

      if (success) {
        await this.updateDownloadState(task.table, task.id);
      }
    } catch (ex) {
      error(ex);
    }
  }

  writeTracks(id, table, trackJSON) {
    const track = new core.Track(id, JSON.parse(trackJSON));

    this.writeTrackFile(id, table, 'gpx', track, 'toGPX');
    this.writeTrackFile(id, table, 'kml', track, 'toKML');
    this.writeTrackFile(id, table, 'srt', track, 'toSRT');
    this.writeTrackFile(id, table, 'geojson', track, 'toGeoJSONString');
    this.writeTrackFile(id, table, 'json', track, 'toJSONString');
  }

  writeTrackFile(id, table, extension, track, method) {
    const outputFileName = path.join(this.mediaPath, table, id + '.' + extension);

    if (!fs.existsSync(outputFileName) || fs.statSync(outputFileName).size === 0) {
      try {
        fs.writeFileSync(outputFileName, track[method]().toString());
      } catch (ex) {
        error('error processing track file', extension, id);
        error(ex);
      }
    }
  }

  async queueMediaDownload(account, table, type) {
    let trackColumn = 'NULL as track';

    if (type === 'video' || type === 'audio') {
      trackColumn = 'track';
    }

    await account.findEachBySQL(`SELECT resource_id, ${ trackColumn } FROM ${ table } WHERE account_id = ${ account.rowID } AND is_stored = 1 AND is_downloaded = 0`, null, ({values}) => {
      if (values) {
        this.queue.push({
          token: account.token,
          type: type,
          table: table,
          id: values.resource_id,
          track: values.track
        });
      }
    });
  }

  async downloadWithRetries(url, outputFileName) {
    let tries = 0;
    const maxTries = 5;

    while (++tries < maxTries) {
      try {
        await this.download(url, outputFileName);

        return outputFileName;
      } catch (ex) {
        if (ex.message === 'not found') {
          return null;
        }

        error('Failed', url, ex.message, 'retrying...');
      }
    }
  }

  download(url, to) {
    return new Promise((resolve, reject) => {
      const req = request
        .get(url)
        .on('response', function(response) {
          if (response.statusCode === 404) {
            this.abort();
          }
        })
        .on('abort', () => reject(new Error('not found')))
        .on('end', () => resolve(req))
        .on('error', reject)
        .pipe(fs.createWriteStream(to));
    });
  }

  updateDownloadState(table, id) {
    // Don't update the state of videos or audio because the track files might come later and we need to re-process them.
    // In order to fix this, we would need to store the download state of the track and the raw video file.
    if (table === 'videos' || table === 'audio') {
      return;
    }

    return this.account.db.execute(`
      UPDATE ${ table } SET is_downloaded = 1 WHERE account_id = ${ this.account.rowID } AND resource_id = '${ id }'
    `);
  }
}
