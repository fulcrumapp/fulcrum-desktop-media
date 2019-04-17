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
        try {
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

          if (success) {
            yield _this.updateDownloadState(task.table, task.id);
          }
        } catch (ex) {
          error(ex);
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
      UPDATE ${table} SET is_downloaded = 1 WHERE account_id = ${this.account.rowID} AND resource_id = '${id}'
    `);
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJsb2ciLCJ3YXJuIiwiZXJyb3IiLCJmdWxjcnVtIiwibG9nZ2VyIiwid2l0aENvbnRleHQiLCJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZmV0Y2hBY2NvdW50IiwiYXJncyIsIm9yZyIsImNvbmN1cnJlbmN5IiwiTWF0aCIsIm1pbiIsIm1heCIsIm1lZGlhQ29uY3VycmVuY3kiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwidHJhY2siLCJ3cml0ZVRyYWNrcyIsInN1Y2Nlc3MiLCJleGlzdHNTeW5jIiwic3RhdFN5bmMiLCJzaXplIiwib3V0cHV0TmFtZSIsImRvd25sb2FkV2l0aFJldHJpZXMiLCJzeW5jIiwiZXgiLCJ1cGRhdGVEb3dubG9hZFN0YXRlIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJoYW5kbGVyIiwiZGlyIiwiZGVhY3RpdmF0ZSIsInRyYWNrSlNPTiIsIlRyYWNrIiwiSlNPTiIsInBhcnNlIiwid3JpdGVUcmFja0ZpbGUiLCJtZXRob2QiLCJ3cml0ZUZpbGVTeW5jIiwidG9TdHJpbmciLCJ0cmFja0NvbHVtbiIsImZpbmRFYWNoQnlTUUwiLCJyb3dJRCIsInZhbHVlcyIsInB1c2giLCJyZXNvdXJjZV9pZCIsInRyaWVzIiwibWF4VHJpZXMiLCJkb3dubG9hZCIsIm1lc3NhZ2UiLCJ0byIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwicmVxIiwiZ2V0Iiwib24iLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJhYm9ydCIsIkVycm9yIiwicGlwZSIsImNyZWF0ZVdyaXRlU3RyZWFtIiwiZGIiLCJleGVjdXRlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOzs7O0FBQ0E7Ozs7Ozs7O0FBRUEsTUFBTSxFQUFFQSxHQUFGLEVBQU9DLElBQVAsRUFBYUMsS0FBYixLQUF1QkMsUUFBUUMsTUFBUixDQUFlQyxXQUFmLENBQTJCLE9BQTNCLENBQTdCOztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQXdCbkJDLFVBeEJtQixxQkF3Qk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxZQUFNQyxVQUFVLE1BQUtBLE9BQUwsR0FBZSxNQUFNTCxRQUFRTSxZQUFSLENBQXFCTixRQUFRTyxJQUFSLENBQWFDLEdBQWxDLENBQXJDOztBQUVBLFVBQUlILE9BQUosRUFBYTtBQUNYLGNBQU1JLGNBQWNDLEtBQUtDLEdBQUwsQ0FBU0QsS0FBS0UsR0FBTCxDQUFTLENBQVQsRUFBWVosUUFBUU8sSUFBUixDQUFhTSxnQkFBYixJQUFpQyxDQUE3QyxDQUFULEVBQTBELEVBQTFELENBQXBCOztBQUVBLGNBQUtDLEtBQUwsR0FBYSw4QkFBb0IsTUFBS0MsTUFBekIsRUFBaUNOLFdBQWpDLENBQWI7O0FBRUEsY0FBTSxNQUFLTyxrQkFBTCxDQUF3QlgsT0FBeEIsRUFBaUMsUUFBakMsRUFBMkMsT0FBM0MsQ0FBTjtBQUNBLGNBQU0sTUFBS1csa0JBQUwsQ0FBd0JYLE9BQXhCLEVBQWlDLFlBQWpDLEVBQStDLFdBQS9DLENBQU47QUFDQSxjQUFNLE1BQUtXLGtCQUFMLENBQXdCWCxPQUF4QixFQUFpQyxPQUFqQyxFQUEwQyxPQUExQyxDQUFOO0FBQ0EsY0FBTSxNQUFLVyxrQkFBTCxDQUF3QlgsT0FBeEIsRUFBaUMsUUFBakMsRUFBMkMsT0FBM0MsQ0FBTjs7QUFFQSxjQUFNLE1BQUtTLEtB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QVVUUSxJQVZTLENBVUosYUFBR0MsaUJBQUgsQ0FBcUJaLEVBQXJCLENBVkksQ0FBWjtBQVdELEtBWk0sQ0FBUDtBQWFEOztBQUVEM0Isc0JBQW9CWixLQUFwQixFQUEyQkMsRUFBM0IsRUFBK0I7QUFDN0I7QUFDQTtBQUNBLFFBQUlELFVBQVUsUUFBVixJQUFzQkEsVUFBVSxPQUFwQyxFQUE2QztBQUMzQztBQUNEOztBQUVELFdBQU8sS0FBSzlCLE9BQUwsQ0FBYWtGLEVBQWIsQ0FBZ0JDLE9BQWhCLENBQXlCO2VBQ3BCckQsS0FBTyw2Q0FBNkMsS0FBSzlCLE9BQUwsQ0FBYTZELEtBQU8sdUJBQXVCOUIsRUFBSTtLQUR4RyxDQUFQO0FBR0Q7QUF0TWtCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgbWtkaXJwIGZyb20gJ21rZGlycCc7XG5pbXBvcnQgQ29uY3VycmVudFF1ZXVlIGZyb20gJy4vY29uY3VycmVudC1xdWV1ZSc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgQVBJQ2xpZW50LCBjb3JlIH0gZnJvbSAnZnVsY3J1bSc7XG5pbXBvcnQgcmVxdWVzdCBmcm9tICdyZXF1ZXN0JztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcblxuY29uc3QgeyBsb2csIHdhcm4sIGVycm9yIH0gPSBmdWxjcnVtLmxvZ2dlci53aXRoQ29udGV4dCgnbWVkaWEnKTtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnbWVkaWEnLFxuICAgICAgZGVzYzogJ2Rvd25sb2FkIG1lZGlhJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBtZWRpYVBhdGg6IHtcbiAgICAgICAgICBkZXNjOiAnbWVkaWEgc3RvcmFnZSBkaXJlY3RvcnknLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhQ29uY3VycmVuY3k6IHtcbiAgICAgICAgICBkZXNjOiAnY29uY3VycmVudCBkb3dubG9hZHMgKGJldHdlZW4gMSBhbmQgMTApJyxcbiAgICAgICAgICB0eXBlOiAnbnVtYmVyJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGNvbnN0IGFjY291bnQgPSB0aGlzLmFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeSA9IE1hdGgubWluKE1hdGgubWF4KDEsIGZ1bGNydW0uYXJncy5tZWRpYUNvbmN1cnJlbmN5IHx8IDUpLCAxMCk7XG5cbiAgICAgIHRoaXMucXVldWUgPSBuZXcgQ29uY3VycmVudFF1ZXVlKHRoaXMud29ya2VyLCBjb25jdXJyZW5jeSk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdwaG90b3MnLCAncGhvdG8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdzaWduYXR1cmVzJywgJ3NpZ25hdHVyZScpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ2F1ZGlvJywgJ2F1ZGlvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAndmlkZW9zJywgJ3ZpZGVvJyk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWUuZHJhaW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICB0aGlzLm1lZGlhUGF0aCA9IGZ1bGNydW0uYXJncy5tZWRpYVBhdGggfHwgZnVsY3J1bS5kaXIoJ21lZGlhJyk7XG5cbiAgICBta2RpcnAuc3luYyh0aGlzLm1lZGlhUGF0aCk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAncGhvdG9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3ZpZGVvcycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdhdWRpbycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdzaWduYXR1cmVzJykpO1xuXG4gICAgLy8gZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICAvLyBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgfVxuXG4gIHdvcmtlciA9IGFzeW5jICh0YXNrKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHVybCA9IHtcbiAgICAgICAgcGhvdG86IEFQSUNsaWVudC5nZXRQaG90b1VSTCxcbiAgICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgICAgYXVkaW86IEFQSUNsaWVudC5nZXRBdWRpb1VSTCxcbiAgICAgICAgc2lnbmF0dXJlOiBBUElDbGllbnQuZ2V0U2lnbmF0dXJlVVJMXG4gICAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgICBjb25zdCBleHRlbnNpb24gPSB7XG4gICAgICAgIHBob3RvOiAnanBnJyxcbiAgICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgICBhdWRpbzogJ200YScsXG4gICAgICAgIHNpZ25hdHVyZTogJ3BuZydcbiAgICAgIH1bdGFzay50eXBlXTtcblxuICAgICAgY29uc3Qgb3V0cHV0RmlsZU5hbWUgPSBwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsIHRhc2sudGFibGUsIHRhc2suaWQgKyAnLicgKyBleHRlbnNpb24pO1xuXG4gICAgICBpZiAodGFzay50cmFjaykge1xuICAgICAgICB0aGlzLndyaXRlVHJhY2tzKHRhc2suaWQsIHRhc2sudGFibGUsIHRhc2sudHJhY2spO1xuICAgICAgfVxuXG4gICAgICBsZXQgc3VjY2VzcyA9IHRydWU7XG5cbiAgICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPCAxMCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGxvZygnRG93bmxvYWRpbmcnLCB0YXNrLnR5cGUsIHRhc2suaWQpO1xuXG4gICAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICAgIGlmIChvdXRwdXROYW1lID09IG51bGwpIHtcbiAgICAgICAgICAgIGxvZygnTm90IEZvdW5kJywgdXJsKTtcbiAgICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgICAgIHN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgICAgbG9nKGV4KTtcbiAgICAgICAgICBzdWNjZXNzID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVEb3dubG9hZFN0YXRlKHRhc2sudGFibGUsIHRhc2suaWQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICBlcnJvcihleCk7XG4gICAgfVxuICB9XG5cbiAgd3JpdGVUcmFja3MoaWQsIHRhYmxlLCB0cmFja0pTT04pIHtcbiAgICBjb25zdCB0cmFjayA9IG5ldyBjb3JlLlRyYWNrKGlkLCBKU09OLnBhcnNlKHRyYWNrSlNPTikpO1xuXG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdncHgnLCB0cmFjaywgJ3RvR1BYJyk7XG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdrbWwnLCB0cmFjaywgJ3RvS01MJyk7XG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdzcnQnLCB0cmFjaywgJ3RvU1JUJyk7XG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdnZW9qc29uJywgdHJhY2ssICd0b0dlb0pTT05TdHJpbmcnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2pzb24nLCB0cmFjaywgJ3RvSlNPTlN0cmluZycpO1xuICB9XG5cbiAgd3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCBleHRlbnNpb24sIHRyYWNrLCBtZXRob2QpIHtcbiAgICBjb25zdCBvdXRwdXRGaWxlTmFtZSA9IHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgdGFibGUsIGlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPT09IDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMob3V0cHV0RmlsZU5hbWUsIHRyYWNrW21ldGhvZF0oKS50b1N0cmluZygpKTtcbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGVycm9yKCdlcnJvciBwcm9jZXNzaW5nIHRyYWNrIGZpbGUnLCBleHRlbnNpb24sIGlkKTtcbiAgICAgICAgZXJyb3IoZXgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCB0YWJsZSwgdHlwZSkge1xuICAgIGxldCB0cmFja0NvbHVtbiA9ICdOVUxMIGFzIHRyYWNrJztcblxuICAgIGlmICh0eXBlID09PSAndmlkZW8nIHx8IHR5cGUgPT09ICdhdWRpbycpIHtcbiAgICAgIHRyYWNrQ29sdW1uID0gJ3RyYWNrJztcbiAgICB9XG5cbiAgICBhd2FpdCBhY2NvdW50LmZpbmRFYWNoQnlTUUwoYFNFTEVDVCByZXNvdXJjZV9pZCwgJHsgdHJhY2tDb2x1bW4gfSBGUk9NICR7IHRhYmxlIH0gV0hFUkUgYWNjb3VudF9pZCA9ICR7IGFjY291bnQucm93SUQgfSBBTkQgaXNfc3RvcmVkID0gMSBBTkQgaXNfZG93bmxvYWRlZCA9IDBgLCBudWxsLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICB0b2tlbjogYWNjb3VudC50b2tlbixcbiAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgIHRhYmxlOiB0YWJsZSxcbiAgICAgICAgICBpZDogdmFsdWVzLnJlc291cmNlX2lkLFxuICAgICAgICAgIHRyYWNrOiB2YWx1ZXMudHJhY2tcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkb3dubG9hZFdpdGhSZXRyaWVzKHVybCwgb3V0cHV0RmlsZU5hbWUpIHtcbiAgICBsZXQgdHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFRyaWVzID0gNTtcblxuICAgIHdoaWxlICgrK3RyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZG93bmxvYWQodXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEZpbGVOYW1lO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgaWYgKGV4Lm1lc3NhZ2UgPT09ICdub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBlcnJvcignRmFpbGVkJywgdXJsLCBleC5tZXNzYWdlLCAncmV0cnlpbmcuLi4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkb3dubG9hZCh1cmwsIHRvKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcSA9IHJlcXVlc3RcbiAgICAgICAgLmdldCh1cmwpXG4gICAgICAgIC5vbigncmVzcG9uc2UnLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICAgICAgICAgIHRoaXMuYWJvcnQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5vbignYWJvcnQnLCAoKSA9PiByZWplY3QobmV3IEVycm9yKCdub3QgZm91bmQnKSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShyZXEpKVxuICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAucGlwZShmcy5jcmVhdGVXcml0ZVN0cmVhbSh0bykpO1xuICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlRG93bmxvYWRTdGF0ZSh0YWJsZSwgaWQpIHtcbiAgICAvLyBEb24ndCB1cGRhdGUgdGhlIHN0YXRlIG9mIHZpZGVvcyBvciBhdWRpbyBiZWNhdXNlIHRoZSB0cmFjayBmaWxlcyBtaWdodCBjb21lIGxhdGVyIGFuZCB3ZSBuZWVkIHRvIHJlLXByb2Nlc3MgdGhlbS5cbiAgICAvLyBJbiBvcmRlciB0byBmaXggdGhpcywgd2Ugd291bGQgbmVlZCB0byBzdG9yZSB0aGUgZG93bmxvYWQgc3RhdGUgb2YgdGhlIHRyYWNrIGFuZCB0aGUgcmF3IHZpZGVvIGZpbGUuXG4gICAgaWYgKHRhYmxlID09PSAndmlkZW9zJyB8fCB0YWJsZSA9PT0gJ2F1ZGlvJykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFjY291bnQuZGIuZXhlY3V0ZShgXG4gICAgICBVUERBVEUgJHsgdGFibGUgfSBTRVQgaXNfZG93bmxvYWRlZCA9IDEgV0hFUkUgYWNjb3VudF9pZCA9ICR7IHRoaXMuYWNjb3VudC5yb3dJRCB9IEFORCByZXNvdXJjZV9pZCA9ICckeyBpZCB9J1xuICAgIGApO1xuICB9XG59XG4iXX0=