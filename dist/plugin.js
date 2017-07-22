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

exports.default = class {
  constructor() {
    var _this = this;

    this.runCommand = _asyncToGenerator(function* () {
      yield _this.activate();

      const account = yield fulcrum.fetchAccount(fulcrum.args.org);

      if (account) {
        const concurrency = Math.min(Math.max(1, fulcrum.args.concurrency || 5), 10);

        _this.queue = new _concurrentQueue2.default(_this.worker, concurrency);

        yield _this.queueMediaDownload(account, 'photos', 'photo');
        yield _this.queueMediaDownload(account, 'signatures', 'signature');
        yield _this.queueMediaDownload(account, 'audio', 'audio');
        yield _this.queueMediaDownload(account, 'videos', 'video');

        yield _this.queue.drain();
      } else {
        console.error('Unable to find account', fulcrum.args.org);
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

        if (!_fs2.default.existsSync(outputFileName) || _fs2.default.statSync(outputFileName).size < 1000) {
          try {
            console.log('Downloading', task.type.green, task.id);

            const outputName = yield _this.downloadWithRetries(url, outputFileName);

            if (outputName == null) {
              console.log('Not Found'.red, url);
              _rimraf2.default.sync(outputFileName);
            }
          } catch (ex) {
            console.log(ex);
          }
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
          concurrency: {
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
      _fs2.default.writeFileSync(outputFileName, track[method]().toString());
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

          console.error('Failed'.red, url, ex.message, 'retrying...');
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
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJjb25jdXJyZW5jeSIsIk1hdGgiLCJtaW4iLCJtYXgiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwiY29uc29sZSIsImVycm9yIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwidHJhY2siLCJ3cml0ZVRyYWNrcyIsImV4aXN0c1N5bmMiLCJzdGF0U3luYyIsInNpemUiLCJsb2ciLCJncmVlbiIsIm91dHB1dE5hbWUiLCJkb3dubG9hZFdpdGhSZXRyaWVzIiwicmVkIiwic3luYyIsImV4IiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJoYW5kbGVyIiwiZGlyIiwiZGVhY3RpdmF0ZSIsInRyYWNrSlNPTiIsIlRyYWNrIiwiSlNPTiIsInBhcnNlIiwid3JpdGVUcmFja0ZpbGUiLCJtZXRob2QiLCJ3cml0ZUZpbGVTeW5jIiwidG9TdHJpbmciLCJ0cmFja0NvbHVtbiIsImZpbmRFYWNoQnlTUUwiLCJyb3dJRCIsInZhbHVlcyIsInB1c2giLCJyZXNvdXJjZV9pZCIsInRyaWVzIiwibWF4VHJpZXMiLCJkb3dubG9hZCIsIm1lc3NhZ2UiLCJ0byIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwicmVxIiwiZ2V0Iiwib24iLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJhYm9ydCIsIkVycm9yIiwicGlwZSIsImNy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QTRCM0IsR0FBNUIsRUFBaUM2QixHQUFHMEIsT0FBcEMsRUFBNkMsYUFBN0M7QUFDRDtBQUNGO0FBaEI0QztBQWlCOUM7O0FBRURELFdBQVN0RCxHQUFULEVBQWN3RCxFQUFkLEVBQWtCO0FBQ2hCLFdBQU8sSUFBSUMsT0FBSixDQUFZLENBQUNDLE9BQUQsRUFBVUMsTUFBVixLQUFxQjtBQUN0QyxZQUFNQyxNQUFNLGtCQUNUQyxHQURTLENBQ0w3RCxHQURLLEVBRVQ4RCxFQUZTLENBRU4sVUFGTSxFQUVNLFVBQVNDLFFBQVQsRUFBbUI7QUFDakMsWUFBSUEsU0FBU0MsVUFBVCxLQUF3QixHQUE1QixFQUFpQztBQUMvQixlQUFLQyxLQUFMO0FBQ0Q7QUFDRixPQU5TLEVBT1RILEVBUFMsQ0FPTixPQVBNLEVBT0csTUFBTUgsT0FBTyxJQUFJTyxLQUFKLENBQVUsV0FBVixDQUFQLENBUFQsRUFRVEosRUFSUyxDQVFOLEtBUk0sRUFRQyxNQUFNSixRQUFRRSxHQUFSLENBUlAsRUFTVEUsRUFUUyxDQVNOLE9BVE0sRUFTR0gsTUFUSCxFQVVUUSxJQVZTLENBVUosYUFBR0MsaUJBQUgsQ0FBcUJaLEVBQXJCLENBVkksQ0FBWjtBQVdELEtBWk0sQ0FBUDtBQWFEO0FBektrQixDIiwiZmlsZSI6InBsdWdpbi5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IG1rZGlycCBmcm9tICdta2RpcnAnO1xuaW1wb3J0IENvbmN1cnJlbnRRdWV1ZSBmcm9tICcuL2NvbmN1cnJlbnQtcXVldWUnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCB7IEFQSUNsaWVudCwgY29yZSB9IGZyb20gJ2Z1bGNydW0nO1xuaW1wb3J0IHJlcXVlc3QgZnJvbSAncmVxdWVzdCc7XG5pbXBvcnQgcmltcmFmIGZyb20gJ3JpbXJhZic7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIHtcbiAgYXN5bmMgdGFzayhjbGkpIHtcbiAgICByZXR1cm4gY2xpLmNvbW1hbmQoe1xuICAgICAgY29tbWFuZDogJ21lZGlhJyxcbiAgICAgIGRlc2M6ICdkb3dubG9hZCBtZWRpYScsXG4gICAgICBidWlsZGVyOiB7XG4gICAgICAgIG9yZzoge1xuICAgICAgICAgIGRlc2M6ICdvcmdhbml6YXRpb24gbmFtZScsXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgbWVkaWFQYXRoOiB7XG4gICAgICAgICAgZGVzYzogJ21lZGlhIHN0b3JhZ2UgZGlyZWN0b3J5JyxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBjb25jdXJyZW5jeToge1xuICAgICAgICAgIGRlc2M6ICdjb25jdXJyZW50IGRvd25sb2FkcyAoYmV0d2VlbiAxIGFuZCAxMCknLFxuICAgICAgICAgIHR5cGU6ICdudW1iZXInXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gTWF0aC5taW4oTWF0aC5tYXgoMSwgZnVsY3J1bS5hcmdzLmNvbmN1cnJlbmN5IHx8IDUpLCAxMCk7XG5cbiAgICAgIHRoaXMucXVldWUgPSBuZXcgQ29uY3VycmVudFF1ZXVlKHRoaXMud29ya2VyLCBjb25jdXJyZW5jeSk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdwaG90b3MnLCAncGhvdG8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdzaWduYXR1cmVzJywgJ3NpZ25hdHVyZScpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ2F1ZGlvJywgJ2F1ZGlvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAndmlkZW9zJywgJ3ZpZGVvJyk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWUuZHJhaW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIHRoaXMubWVkaWFQYXRoID0gZnVsY3J1bS5hcmdzLm1lZGlhUGF0aCB8fCBmdWxjcnVtLmRpcignbWVkaWEnKTtcblxuICAgIG1rZGlycC5zeW5jKHRoaXMubWVkaWFQYXRoKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdwaG90b3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAndmlkZW9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ2F1ZGlvJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3NpZ25hdHVyZXMnKSk7XG5cbiAgICAvLyBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIC8vIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICB9XG5cbiAgd29ya2VyID0gYXN5bmMgKHRhc2spID0+IHtcbiAgICBjb25zdCB1cmwgPSB7XG4gICAgICBwaG90bzogQVBJQ2xpZW50LmdldFBob3RvVVJMLFxuICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgIGF1ZGlvOiBBUElDbGllbnQuZ2V0QXVkaW9VUkwsXG4gICAgICBzaWduYXR1cmU6IEFQSUNsaWVudC5nZXRTaWduYXR1cmVVUkxcbiAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICh0YXNrLnRyYWNrKSB7XG4gICAgICB0aGlzLndyaXRlVHJhY2tzKHRhc2suaWQsIHRhc2sudGFibGUsIHRhc2sudHJhY2spO1xuICAgIH1cblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPCAxMDAwKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnRG93bmxvYWRpbmcnLCB0YXNrLnR5cGUuZ3JlZW4sIHRhc2suaWQpO1xuXG4gICAgICAgIGNvbnN0IG91dHB1dE5hbWUgPSBhd2FpdCB0aGlzLmRvd25sb2FkV2l0aFJldHJpZXModXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgaWYgKG91dHB1dE5hbWUgPT0gbnVsbCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdOb3QgRm91bmQnLnJlZCwgdXJsKTtcbiAgICAgICAgICByaW1yYWYuc3luYyhvdXRwdXRGaWxlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGV4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB3cml0ZVRyYWNrcyhpZCwgdGFibGUsIHRyYWNrSlNPTikge1xuICAgIGNvbnN0IHRyYWNrID0gbmV3IGNvcmUuVHJhY2soaWQsIEpTT04ucGFyc2UodHJhY2tKU09OKSk7XG5cbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dweCcsIHRyYWNrLCAndG9HUFgnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2ttbCcsIHRyYWNrLCAndG9LTUwnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ3NydCcsIHRyYWNrLCAndG9TUlQnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dlb2pzb24nLCB0cmFjaywgJ3RvR2VvSlNPTlN0cmluZycpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnanNvbicsIHRyYWNrLCAndG9KU09OU3RyaW5nJyk7XG4gIH1cblxuICB3cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsIGV4dGVuc2lvbiwgdHJhY2ssIG1ldGhvZCkge1xuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YWJsZSwgaWQgKyAnLicgKyBleHRlbnNpb24pO1xuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKG91dHB1dEZpbGVOYW1lKSB8fCBmcy5zdGF0U3luYyhvdXRwdXRGaWxlTmFtZSkuc2l6ZSA9PT0gMCkge1xuICAgICAgZnMud3JpdGVGaWxlU3luYyhvdXRwdXRGaWxlTmFtZSwgdHJhY2tbbWV0aG9kXSgpLnRvU3RyaW5nKCkpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCB0YWJsZSwgdHlwZSkge1xuICAgIGxldCB0cmFja0NvbHVtbiA9ICdOVUxMIGFzIHRyYWNrJztcblxuICAgIGlmICh0eXBlID09PSAndmlkZW8nIHx8IHR5cGUgPT09ICdhdWRpbycpIHtcbiAgICAgIHRyYWNrQ29sdW1uID0gJ3RyYWNrJztcbiAgICB9XG5cbiAgICBhd2FpdCBhY2NvdW50LmZpbmRFYWNoQnlTUUwoYFNFTEVDVCByZXNvdXJjZV9pZCwgJHsgdHJhY2tDb2x1bW4gfSBGUk9NICR7IHRhYmxlIH0gV0hFUkUgYWNjb3VudF9pZCA9ICR7IGFjY291bnQucm93SUQgfSBBTkQgaXNfc3RvcmVkID0gMSBBTkQgaXNfZG93bmxvYWRlZCA9IDBgLCBudWxsLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICB0b2tlbjogYWNjb3VudC50b2tlbixcbiAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgIHRhYmxlOiB0YWJsZSxcbiAgICAgICAgICBpZDogdmFsdWVzLnJlc291cmNlX2lkLFxuICAgICAgICAgIHRyYWNrOiB2YWx1ZXMudHJhY2tcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkb3dubG9hZFdpdGhSZXRyaWVzKHVybCwgb3V0cHV0RmlsZU5hbWUpIHtcbiAgICBsZXQgdHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFRyaWVzID0gNTtcblxuICAgIHdoaWxlICgrK3RyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZG93bmxvYWQodXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEZpbGVOYW1lO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgaWYgKGV4Lm1lc3NhZ2UgPT09ICdub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQnLnJlZCwgdXJsLCBleC5tZXNzYWdlLCAncmV0cnlpbmcuLi4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkb3dubG9hZCh1cmwsIHRvKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcSA9IHJlcXVlc3RcbiAgICAgICAgLmdldCh1cmwpXG4gICAgICAgIC5vbigncmVzcG9uc2UnLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICAgICAgICAgIHRoaXMuYWJvcnQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5vbignYWJvcnQnLCAoKSA9PiByZWplY3QobmV3IEVycm9yKCdub3QgZm91bmQnKSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShyZXEpKVxuICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAucGlwZShmcy5jcmVhdGVXcml0ZVN0cmVhbSh0bykpO1xuICAgIH0pO1xuICB9XG59XG4iXX0=