import path from 'path';
import mkdirp from 'mkdirp';
import ConcurrentQueue from './concurrent-queue';
import fs from 'fs';
import { APIClient } from 'fulcrum';
import request from 'request';
import rimraf from 'rimraf';

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
        concurrency: {
          desc: 'concurrent downloads (between 1 and 10)',
          type: 'number'
        }
      },
      handler: this.runCommand
    });
  }

  runCommand = async () => {
    await this.activate();

    const account = await fulcrum.fetchAccount(fulcrum.args.org);

    if (account) {
      const concurrency = Math.min(Math.max(1, fulcrum.args.concurrency || 5), 10);

      this.queue = new ConcurrentQueue(this.worker, concurrency);

      await this.queueMediaDownload(account, 'photos', 'photo');
      await this.queueMediaDownload(account, 'signatures', 'signature');
      await this.queueMediaDownload(account, 'audio', 'audio');
      await this.queueMediaDownload(account, 'videos', 'video');

      await this.queue.drain();
    } else {
      console.error('Unable to find account', fulcrum.args.org);
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

    if (!fs.existsSync(outputFileName) || fs.statSync(outputFileName).size === 0) {
      try {
        console.log('Downloading', task.type.green, task.id);

        const outputName = await this.downloadWithRetries(url, outputFileName);

        if (outputName == null) {
          console.log('Not Found'.red, url);
          rimraf.sync(outputFileName);
        }
      } catch (ex) {
        console.log(ex);
      }
    }
  }

  async queueMediaDownload(account, table, type) {
    await account.findEachBySQL(`SELECT resource_id FROM ${ table } WHERE is_downloaded = 0`, [], ({values}) => {
      if (values) {
        this.queue.push({
          token: account.token,
          type: type,
          table: table,
          id: values.resource_id
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

        console.error('Failed'.red, url, ex.message, 'retrying...');
      }
    }
  }

  download(url, to) {
    return new Promise((resolve, reject) => {
      const rq = request(url).pipe(fs.createWriteStream(to));

      rq.on('response', function (response) {
            if (response.statusCode !== 200) {
              this.abort();
            }
          })
        .on('abort', () => reject(new Error('not found')))
        .on('close', () => resolve(rq))
        .on('error', reject);
    });
  }
}
