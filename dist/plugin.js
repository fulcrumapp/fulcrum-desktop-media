'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _mkdirp = require('mkdirp');

var _mkdirp2 = _interopRequireDefault(_mkdirp);

var _concurrentQueue = require('./concurrent-queue');

var _concurrentQueue2 = _interopRequireDefault(_concurrentQueue);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _fulcrumDesktopPlugin = require('fulcrum-desktop-plugin');

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

var _rimraf = require('rimraf');

var _rimraf2 = _interopRequireDefault(_rimraf);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const { log, warn, error } = fulcrum.logger.withContext('media');

exports.default = class {
  constructor() {
    var _this = this;

    this.runCommand = _asyncToGenerator(function* () {
      yield _this.activate();

      const account = _this.account = yield fulcrum.fetchAccount(fulcrum.args.org);

      if (account) {
        const concurrency = Math.min(Math.max(1, fulcrum.args.mediaConcurrency || 5), 10);

        _this.queue = new _concurrentQueue2.default(_this.worker, concurrency);

        yield _this.queueMediaDownload(account, 'photos', 'photo');
        yield _this.queueMediaDownload(account, 'signatures', 'signature');
        yield _this.queueMediaDownload(account, 'audio', 'audio');
        yield _this.queueMediaDownload(account, 'videos', 'video');

        yield _this.queue.drain();
      } else {
        error('Unable to find account', fulcrum.args.org);
      }
    });

    this.worker = (() => {
      var _ref2 = _asyncToGenerator(function* (task) {
        const url = {
          photo: _fulcrumDesktopPlugin.APIClient.getPhotoURL,
          video: _fulcrumDesktopPlugin.APIClient.getVideoURL,
          audio: _fulcrumDesktopPlugin.APIClient.getAudioURL,
          signature: _fulcrumDesktopPlugin.APIClient.getSignatureURL
        }[task.type].bind(_fulcrumDesktopPlugin.APIClient)({ token: task.token }, task);

        const extension = {
          photo: 'jpg',
          video: 'mp4',
          audio: 'm4a',
          signature: 'png'
        }[task.type];

        const outputFileName = _path2.default.join(_this.mediaPath, task.table, task.id + '.' + extension);

        if (task.track) {
          _this.writeTracks(task.id, task.table, task.track);
        }

        let success = true;

        if (!_fs2.default.existsSync(outputFileName) || _fs2.default.statSync(outputFileName).size < 10) {
          try {
            log('Downloading', task.type, task.id);

            const outputName = yield _this.downloadWithRetries(url, outputFileName);

            if (outputName == null) {
              log('Not Found', url);
              _rimraf2.default.sync(outputFileName);
              success = false;
            }
          } catch (ex) {
            log(ex);
            success = false;
          }
        }

        if (downloaded) {
          yield _this.updateDownloadState(task.table, task.id);
        }
      });

      return function (_x) {
        return _ref2.apply(this, arguments);
      };
    })();
  }

  task(cli) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
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
        handler: _this2.runCommand
      });
    })();
  }

  activate() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      _this3.mediaPath = fulcrum.args.mediaPath || fulcrum.dir('media');

      _mkdirp2.default.sync(_this3.mediaPath);
      _mkdirp2.default.sync(_path2.default.join(_this3.mediaPath, 'photos'));
      _mkdirp2.default.sync(_path2.default.join(_this3.mediaPath, 'videos'));
      _mkdirp2.default.sync(_path2.default.join(_this3.mediaPath, 'audio'));
      _mkdirp2.default.sync(_path2.default.join(_this3.mediaPath, 'signatures'));

      // fulcrum.on('form:save', this.onFormSave);
      // fulcrum.on('records:finish', this.onRecordsFinished);
    })();
  }

  deactivate() {
    return _asyncToGenerator(function* () {})();
  }

  writeTracks(id, table, trackJSON) {
    const track = new _fulcrumDesktopPlugin.core.Track(id, JSON.parse(trackJSON));

    this.writeTrackFile(id, table, 'gpx', track, 'toGPX');
    this.writeTrackFile(id, table, 'kml', track, 'toKML');
    this.writeTrackFile(id, table, 'srt', track, 'toSRT');
    this.writeTrackFile(id, table, 'geojson', track, 'toGeoJSONString');
    this.writeTrackFile(id, table, 'json', track, 'toJSONString');
  }

  writeTrackFile(id, table, extension, track, method) {
    const outputFileName = _path2.default.join(this.mediaPath, table, id + '.' + extension);

    if (!_fs2.default.existsSync(outputFileName) || _fs2.default.statSync(outputFileName).size === 0) {
      try {
        _fs2.default.writeFileSync(outputFileName, track[method]().toString());
      } catch (ex) {
        error('error processing track file', extension, id);
        error(ex);
      }
    }
  }

  queueMediaDownload(account, table, type) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      let trackColumn = 'NULL as track';

      if (type === 'video' || type === 'audio') {
        trackColumn = 'track';
      }

      yield account.findEachBySQL(`SELECT resource_id, ${trackColumn} FROM ${table} WHERE account_id = ${account.rowID} AND is_stored = 1 AND is_downloaded = 0`, null, function ({ values }) {
        if (values) {
          _this4.queue.push({
            token: account.token,
            type: type,
            table: table,
            id: values.resource_id,
            track: values.track
          });
        }
      });
    })();
  }

  downloadWithRetries(url, outputFileName) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      let tries = 0;
      const maxTries = 5;

      while (++tries < maxTries) {
        try {
          yield _this5.download(url, outputFileName);

          return outputFileName;
        } catch (ex) {
          if (ex.message === 'not found') {
            return null;
          }

          error('Failed', url, ex.message, 'retrying...');
        }
      }
    })();
  }

  download(url, to) {
    return new Promise((resolve, reject) => {
      const req = _request2.default.get(url).on('response', function (response) {
        if (response.statusCode === 404) {
          this.abort();
        }
      }).on('abort', () => reject(new Error('not found'))).on('end', () => resolve(req)).on('error', reject).pipe(_fs2.default.createWriteStream(to));
    });
  }

  updateDownloadState(table, id) {
    // Don't update the state of videos or audio because the track files might come later and we need to re-process them.
    // In order to fix this, we would need to store the download state of the track and the raw video file.
    if (table === 'videos' || table === 'audio') {
      return;
    }

    return this.account.db.execute(`
      UPDATE ${table} SET is_downloaded = 1 WHERE WHERE account_id = ${this.account.rowID} AND resource_id = '${id}'
    `);
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJsb2ciLCJ3YXJuIiwiZXJyb3IiLCJmdWxjcnVtIiwibG9nZ2VyIiwid2l0aENvbnRleHQiLCJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZmV0Y2hBY2NvdW50IiwiYXJncyIsIm9yZyIsImNvbmN1cnJlbmN5IiwiTWF0aCIsIm1pbiIsIm1heCIsIm1lZGlhQ29uY3VycmVuY3kiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwidHJhY2siLCJ3cml0ZVRyYWNrcyIsInN1Y2Nlc3MiLCJleGlzdHNTeW5jIiwic3RhdFN5bmMiLCJzaXplIiwib3V0cHV0TmFtZSIsImRvd25sb2FkV2l0aFJldHJpZXMiLCJzeW5jIiwiZXgiLCJkb3dubG9hZGVkIiwidXBkYXRlRG93bmxvYWRTdGF0ZSIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwiaGFuZGxlciIsImRpciIsImRlYWN0aXZhdGUiLCJ0cmFja0pTT04iLCJUcmFjayIsIkpTT04iLCJwYXJzZSIsIndyaXRlVHJhY2tGaWxlIiwibWV0aG9kIiwid3JpdGVGaWxlU3luYyIsInRvU3RyaW5nIiwidHJhY2tDb2x1bW4iLCJmaW5kRWFjaEJ5U1FMIiwicm93SUQiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJ0cmllcyIsIm1heFRyaWVzIiwiZG93bmxvYWQiLCJtZXNzYWdlIiwidG8iLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInJlcSIsImdldCIsIm9uIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiYWJvcnQiLCJFcnJvciIsInBpcGUiLCJjcmVhdGVXcml0ZVN0cmVhbSIsImRiIiwiZXhlY3V0ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7OztBQUVBLE1BQU0sRUFBRUEsR0FBRixFQUFPQyxJQUFQLEVBQWFDLEtBQWIsS0FBdUJDLFFBQVFDLE1BQVIsQ0FBZUMsV0FBZixDQUEyQixPQUEzQixDQUE3Qjs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0F3Qm5CQyxVQXhCbUIscUJBd0JOLGFBQVk7QUFDdkIsWUFBTSxNQUFLQyxRQUFMLEVBQU47O0FBRUEsWUFBTUMsVUFBVSxNQUFLQSxPQUFMLEdBQWUsTUFBTUwsUUFBUU0sWUFBUixDQUFxQk4sUUFBUU8sSUFBUixDQUFhQyxHQUFsQyxDQUFyQzs7QUFFQSxVQUFJSCxPQUFKLEVBQWE7QUFDWCxjQUFNSSxjQUFjQyxLQUFLQyxHQUFMLENBQVNELEtBQUtFLEdBQUwsQ0FBUyxDQUFULEVBQVlaLFFBQVFPLElBQVIsQ0FBYU0sZ0JBQWIsSUFBaUMsQ0FBN0MsQ0FBVCxFQUEwRCxFQUExRCxDQUFwQjs7QUFFQSxjQUFLQyxLQUFMLEdBQWEsOEJBQW9CLE1BQUtDLE1BQXpCLEVBQWlDTixXQUFqQyxDQUFiOztBQUVBLGNBQU0sTUFBS08sa0JBQUwsQ0FBd0JYLE9BQXhCLEVBQWlDLFFBQWpDLEVBQTJDLE9BQTNDLENBQU47QUFDQSxjQUFNLE1BQUtXLGtCQUFMLENBQXdCWCxPQUF4QixFQUFpQyxZQUFqQyxFQUErQyxXQUEvQyxDQUFOO0FBQ0EsY0FBTSxNQUFLVyxrQkFBTCxDQUF3QlgsT0FBeEIsRUFBaUMsT0FBakMsRUFBMEMsT0FBMUMsQ0FBTjtBQUNBLGNBQU0sTUFBS1csa0JBQUwsQ0FBd0JYLE9BQXhCLEVBQWlDLFFBQWpDLEVBQTJDLE9BQTNDLENBQU47O0FBRUEs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TSxDQUFQO0FBYUQ7O0FBRUQzQixzQkFBb0JiLEtBQXBCLEVBQTJCQyxFQUEzQixFQUErQjtBQUM3QjtBQUNBO0FBQ0EsUUFBSUQsVUFBVSxRQUFWLElBQXNCQSxVQUFVLE9BQXBDLEVBQTZDO0FBQzNDO0FBQ0Q7O0FBRUQsV0FBTyxLQUFLOUIsT0FBTCxDQUFhbUYsRUFBYixDQUFnQkMsT0FBaEIsQ0FBeUI7ZUFDcEJ0RCxLQUFPLG1EQUFtRCxLQUFLOUIsT0FBTCxDQUFhOEQsS0FBTyx1QkFBdUIvQixFQUFJO0tBRDlHLENBQVA7QUFHRDtBQWxNa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBta2RpcnAgZnJvbSAnbWtkaXJwJztcbmltcG9ydCBDb25jdXJyZW50UXVldWUgZnJvbSAnLi9jb25jdXJyZW50LXF1ZXVlJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgeyBBUElDbGllbnQsIGNvcmUgfSBmcm9tICdmdWxjcnVtJztcbmltcG9ydCByZXF1ZXN0IGZyb20gJ3JlcXVlc3QnO1xuaW1wb3J0IHJpbXJhZiBmcm9tICdyaW1yYWYnO1xuXG5jb25zdCB7IGxvZywgd2FybiwgZXJyb3IgfSA9IGZ1bGNydW0ubG9nZ2VyLndpdGhDb250ZXh0KCdtZWRpYScpO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdtZWRpYScsXG4gICAgICBkZXNjOiAnZG93bmxvYWQgbWVkaWEnLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdtZWRpYSBzdG9yYWdlIGRpcmVjdG9yeScsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgbWVkaWFDb25jdXJyZW5jeToge1xuICAgICAgICAgIGRlc2M6ICdjb25jdXJyZW50IGRvd25sb2FkcyAoYmV0d2VlbiAxIGFuZCAxMCknLFxuICAgICAgICAgIHR5cGU6ICdudW1iZXInXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgY29uc3QgYWNjb3VudCA9IHRoaXMuYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gTWF0aC5taW4oTWF0aC5tYXgoMSwgZnVsY3J1bS5hcmdzLm1lZGlhQ29uY3VycmVuY3kgfHwgNSksIDEwKTtcblxuICAgICAgdGhpcy5xdWV1ZSA9IG5ldyBDb25jdXJyZW50UXVldWUodGhpcy53b3JrZXIsIGNvbmN1cnJlbmN5KTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3Bob3RvcycsICdwaG90bycpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3NpZ25hdHVyZXMnLCAnc2lnbmF0dXJlJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAnYXVkaW8nLCAnYXVkaW8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICd2aWRlb3MnLCAndmlkZW8nKTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZS5kcmFpbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIHRoaXMubWVkaWFQYXRoID0gZnVsY3J1bS5hcmdzLm1lZGlhUGF0aCB8fCBmdWxjcnVtLmRpcignbWVkaWEnKTtcblxuICAgIG1rZGlycC5zeW5jKHRoaXMubWVkaWFQYXRoKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdwaG90b3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAndmlkZW9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ2F1ZGlvJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3NpZ25hdHVyZXMnKSk7XG5cbiAgICAvLyBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIC8vIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICB9XG5cbiAgd29ya2VyID0gYXN5bmMgKHRhc2spID0+IHtcbiAgICBjb25zdCB1cmwgPSB7XG4gICAgICBwaG90bzogQVBJQ2xpZW50LmdldFBob3RvVVJMLFxuICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgIGF1ZGlvOiBBUElDbGllbnQuZ2V0QXVkaW9VUkwsXG4gICAgICBzaWduYXR1cmU6IEFQSUNsaWVudC5nZXRTaWduYXR1cmVVUkxcbiAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICh0YXNrLnRyYWNrKSB7XG4gICAgICB0aGlzLndyaXRlVHJhY2tzKHRhc2suaWQsIHRhc2sudGFibGUsIHRhc2sudHJhY2spO1xuICAgIH1cblxuICAgIGxldCBzdWNjZXNzID0gdHJ1ZTtcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPCAxMCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbG9nKCdEb3dubG9hZGluZycsIHRhc2sudHlwZSwgdGFzay5pZCk7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICBpZiAob3V0cHV0TmFtZSA9PSBudWxsKSB7XG4gICAgICAgICAgbG9nKCdOb3QgRm91bmQnLCB1cmwpO1xuICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgICBzdWNjZXNzID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGxvZyhleCk7XG4gICAgICAgIHN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZG93bmxvYWRlZCkge1xuICAgICAgYXdhaXQgdGhpcy51cGRhdGVEb3dubG9hZFN0YXRlKHRhc2sudGFibGUsIHRhc2suaWQpO1xuICAgIH1cbiAgfVxuXG4gIHdyaXRlVHJhY2tzKGlkLCB0YWJsZSwgdHJhY2tKU09OKSB7XG4gICAgY29uc3QgdHJhY2sgPSBuZXcgY29yZS5UcmFjayhpZCwgSlNPTi5wYXJzZSh0cmFja0pTT04pKTtcblxuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnZ3B4JywgdHJhY2ssICd0b0dQWCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAna21sJywgdHJhY2ssICd0b0tNTCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnc3J0JywgdHJhY2ssICd0b1NSVCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnZ2VvanNvbicsIHRyYWNrLCAndG9HZW9KU09OU3RyaW5nJyk7XG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdqc29uJywgdHJhY2ssICd0b0pTT05TdHJpbmcnKTtcbiAgfVxuXG4gIHdyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgZXh0ZW5zaW9uLCB0cmFjaywgbWV0aG9kKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZU5hbWUgPSBwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsIHRhYmxlLCBpZCArICcuJyArIGV4dGVuc2lvbik7XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMob3V0cHV0RmlsZU5hbWUpIHx8IGZzLnN0YXRTeW5jKG91dHB1dEZpbGVOYW1lKS5zaXplID09PSAwKSB7XG4gICAgICB0cnkge1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKG91dHB1dEZpbGVOYW1lLCB0cmFja1ttZXRob2RdKCkudG9TdHJpbmcoKSk7XG4gICAgICB9IGNhdGNoIChleCkge1xuICAgICAgICBlcnJvcignZXJyb3IgcHJvY2Vzc2luZyB0cmFjayBmaWxlJywgZXh0ZW5zaW9uLCBpZCk7XG4gICAgICAgIGVycm9yKGV4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBxdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgdGFibGUsIHR5cGUpIHtcbiAgICBsZXQgdHJhY2tDb2x1bW4gPSAnTlVMTCBhcyB0cmFjayc7XG5cbiAgICBpZiAodHlwZSA9PT0gJ3ZpZGVvJyB8fCB0eXBlID09PSAnYXVkaW8nKSB7XG4gICAgICB0cmFja0NvbHVtbiA9ICd0cmFjayc7XG4gICAgfVxuXG4gICAgYXdhaXQgYWNjb3VudC5maW5kRWFjaEJ5U1FMKGBTRUxFQ1QgcmVzb3VyY2VfaWQsICR7IHRyYWNrQ29sdW1uIH0gRlJPTSAkeyB0YWJsZSB9IFdIRVJFIGFjY291bnRfaWQgPSAkeyBhY2NvdW50LnJvd0lEIH0gQU5EIGlzX3N0b3JlZCA9IDEgQU5EIGlzX2Rvd25sb2FkZWQgPSAwYCwgbnVsbCwgKHt2YWx1ZXN9KSA9PiB7XG4gICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgIHRoaXMucXVldWUucHVzaCh7XG4gICAgICAgICAgdG9rZW46IGFjY291bnQudG9rZW4sXG4gICAgICAgICAgdHlwZTogdHlwZSxcbiAgICAgICAgICB0YWJsZTogdGFibGUsXG4gICAgICAgICAgaWQ6IHZhbHVlcy5yZXNvdXJjZV9pZCxcbiAgICAgICAgICB0cmFjazogdmFsdWVzLnRyYWNrXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKSB7XG4gICAgbGV0IHRyaWVzID0gMDtcbiAgICBjb25zdCBtYXhUcmllcyA9IDU7XG5cbiAgICB3aGlsZSAoKyt0cmllcyA8IG1heFRyaWVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmRvd25sb2FkKHVybCwgb3V0cHV0RmlsZU5hbWUpO1xuXG4gICAgICAgIHJldHVybiBvdXRwdXRGaWxlTmFtZTtcbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGlmIChleC5tZXNzYWdlID09PSAnbm90IGZvdW5kJykge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgZXJyb3IoJ0ZhaWxlZCcsIHVybCwgZXgubWVzc2FnZSwgJ3JldHJ5aW5nLi4uJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZG93bmxvYWQodXJsLCB0bykge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXEgPSByZXF1ZXN0XG4gICAgICAgIC5nZXQodXJsKVxuICAgICAgICAub24oJ3Jlc3BvbnNlJywgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzQ29kZSA9PT0gNDA0KSB7XG4gICAgICAgICAgICB0aGlzLmFib3J0KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Fib3J0JywgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignbm90IGZvdW5kJykpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHJlc29sdmUocmVxKSlcbiAgICAgICAgLm9uKCdlcnJvcicsIHJlamVjdClcbiAgICAgICAgLnBpcGUoZnMuY3JlYXRlV3JpdGVTdHJlYW0odG8pKTtcbiAgICB9KTtcbiAgfVxuXG4gIHVwZGF0ZURvd25sb2FkU3RhdGUodGFibGUsIGlkKSB7XG4gICAgLy8gRG9uJ3QgdXBkYXRlIHRoZSBzdGF0ZSBvZiB2aWRlb3Mgb3IgYXVkaW8gYmVjYXVzZSB0aGUgdHJhY2sgZmlsZXMgbWlnaHQgY29tZSBsYXRlciBhbmQgd2UgbmVlZCB0byByZS1wcm9jZXNzIHRoZW0uXG4gICAgLy8gSW4gb3JkZXIgdG8gZml4IHRoaXMsIHdlIHdvdWxkIG5lZWQgdG8gc3RvcmUgdGhlIGRvd25sb2FkIHN0YXRlIG9mIHRoZSB0cmFjayBhbmQgdGhlIHJhdyB2aWRlbyBmaWxlLlxuICAgIGlmICh0YWJsZSA9PT0gJ3ZpZGVvcycgfHwgdGFibGUgPT09ICdhdWRpbycpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hY2NvdW50LmRiLmV4ZWN1dGUoYFxuICAgICAgVVBEQVRFICR7IHRhYmxlIH0gU0VUIGlzX2Rvd25sb2FkZWQgPSAxIFdIRVJFIFdIRVJFIGFjY291bnRfaWQgPSAkeyB0aGlzLmFjY291bnQucm93SUQgfSBBTkQgcmVzb3VyY2VfaWQgPSAnJHsgaWQgfSdcbiAgICBgKTtcbiAgfVxufVxuIl19