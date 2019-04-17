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

      const account = yield fulcrum.fetchAccount(fulcrum.args.org);

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

        if (!_fs2.default.existsSync(outputFileName) || _fs2.default.statSync(outputFileName).size < 10) {
          try {
            log('Downloading', task.type, task.id);

            const outputName = yield _this.downloadWithRetries(url, outputFileName);

            if (outputName == null) {
              log('Not Found', url);
              _rimraf2.default.sync(outputFileName);
            }
          } catch (ex) {
            log(ex);
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
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJsb2ciLCJ3YXJuIiwiZXJyb3IiLCJmdWxjcnVtIiwibG9nZ2VyIiwid2l0aENvbnRleHQiLCJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZmV0Y2hBY2NvdW50IiwiYXJncyIsIm9yZyIsImNvbmN1cnJlbmN5IiwiTWF0aCIsIm1pbiIsIm1heCIsIm1lZGlhQ29uY3VycmVuY3kiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwidHJhY2siLCJ3cml0ZVRyYWNrcyIsImV4aXN0c1N5bmMiLCJzdGF0U3luYyIsInNpemUiLCJvdXRwdXROYW1lIiwiZG93bmxvYWRXaXRoUmV0cmllcyIsInN5bmMiLCJleCIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwiaGFuZGxlciIsImRpciIsImRlYWN0aXZhdGUiLCJ0cmFja0pTT04iLCJUcmFjayIsIkpTT04iLCJwYXJzZSIsIndyaXRlVHJhY2tGaWxlIiwibWV0aG9kIiwid3JpdGVGaWxlU3luYyIsInRvU3RyaW5nIiwidHJhY2tDb2x1bW4iLCJmaW5kRWFjaEJ5U1FMIiwicm93SUQiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJ0cmllcyIsIm1heFRyaWVzIiwiZG93bmxvYWQiLCJtZXNzYWdlIiwidG8iLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInJlcSIsImdldCIsIm9uIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwi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QUFuQixDQUFOOztBQUVBLGlCQUFPQSxjQUFQO0FBQ0QsU0FKRCxDQUlFLE9BQU9hLEVBQVAsRUFBVztBQUNYLGNBQUlBLEdBQUcwQixPQUFILEtBQWUsV0FBbkIsRUFBZ0M7QUFDOUIsbUJBQU8sSUFBUDtBQUNEOztBQUVEeEUsZ0JBQU0sUUFBTixFQUFnQm9CLEdBQWhCLEVBQXFCMEIsR0FBRzBCLE9BQXhCLEVBQWlDLGFBQWpDO0FBQ0Q7QUFDRjtBQWhCNEM7QUFpQjlDOztBQUVERCxXQUFTbkQsR0FBVCxFQUFjcUQsRUFBZCxFQUFrQjtBQUNoQixXQUFPLElBQUlDLE9BQUosQ0FBWSxDQUFDQyxPQUFELEVBQVVDLE1BQVYsS0FBcUI7QUFDdEMsWUFBTUMsTUFBTSxrQkFDVEMsR0FEUyxDQUNMMUQsR0FESyxFQUVUMkQsRUFGUyxDQUVOLFVBRk0sRUFFTSxVQUFTQyxRQUFULEVBQW1CO0FBQ2pDLFlBQUlBLFNBQVNDLFVBQVQsS0FBd0IsR0FBNUIsRUFBaUM7QUFDL0IsZUFBS0MsS0FBTDtBQUNEO0FBQ0YsT0FOUyxFQU9USCxFQVBTLENBT04sT0FQTSxFQU9HLE1BQU1ILE9BQU8sSUFBSU8sS0FBSixDQUFVLFdBQVYsQ0FBUCxDQVBULEVBUVRKLEVBUlMsQ0FRTixLQVJNLEVBUUMsTUFBTUosUUFBUUUsR0FBUixDQVJQLEVBU1RFLEVBVFMsQ0FTTixPQVRNLEVBU0dILE1BVEgsRUFVVFEsSUFWUyxDQVVKLGFBQUdDLGlCQUFILENBQXFCWixFQUFyQixDQVZJLENBQVo7QUFXRCxLQVpNLENBQVA7QUFhRDtBQTlLa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBta2RpcnAgZnJvbSAnbWtkaXJwJztcbmltcG9ydCBDb25jdXJyZW50UXVldWUgZnJvbSAnLi9jb25jdXJyZW50LXF1ZXVlJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgeyBBUElDbGllbnQsIGNvcmUgfSBmcm9tICdmdWxjcnVtJztcbmltcG9ydCByZXF1ZXN0IGZyb20gJ3JlcXVlc3QnO1xuaW1wb3J0IHJpbXJhZiBmcm9tICdyaW1yYWYnO1xuXG5jb25zdCB7IGxvZywgd2FybiwgZXJyb3IgfSA9IGZ1bGNydW0ubG9nZ2VyLndpdGhDb250ZXh0KCdtZWRpYScpO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdtZWRpYScsXG4gICAgICBkZXNjOiAnZG93bmxvYWQgbWVkaWEnLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdtZWRpYSBzdG9yYWdlIGRpcmVjdG9yeScsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgbWVkaWFDb25jdXJyZW5jeToge1xuICAgICAgICAgIGRlc2M6ICdjb25jdXJyZW50IGRvd25sb2FkcyAoYmV0d2VlbiAxIGFuZCAxMCknLFxuICAgICAgICAgIHR5cGU6ICdudW1iZXInXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gTWF0aC5taW4oTWF0aC5tYXgoMSwgZnVsY3J1bS5hcmdzLm1lZGlhQ29uY3VycmVuY3kgfHwgNSksIDEwKTtcblxuICAgICAgdGhpcy5xdWV1ZSA9IG5ldyBDb25jdXJyZW50UXVldWUodGhpcy53b3JrZXIsIGNvbmN1cnJlbmN5KTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3Bob3RvcycsICdwaG90bycpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3NpZ25hdHVyZXMnLCAnc2lnbmF0dXJlJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAnYXVkaW8nLCAnYXVkaW8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICd2aWRlb3MnLCAndmlkZW8nKTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZS5kcmFpbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIHRoaXMubWVkaWFQYXRoID0gZnVsY3J1bS5hcmdzLm1lZGlhUGF0aCB8fCBmdWxjcnVtLmRpcignbWVkaWEnKTtcblxuICAgIG1rZGlycC5zeW5jKHRoaXMubWVkaWFQYXRoKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdwaG90b3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAndmlkZW9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ2F1ZGlvJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3NpZ25hdHVyZXMnKSk7XG5cbiAgICAvLyBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIC8vIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICB9XG5cbiAgd29ya2VyID0gYXN5bmMgKHRhc2spID0+IHtcbiAgICBjb25zdCB1cmwgPSB7XG4gICAgICBwaG90bzogQVBJQ2xpZW50LmdldFBob3RvVVJMLFxuICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgIGF1ZGlvOiBBUElDbGllbnQuZ2V0QXVkaW9VUkwsXG4gICAgICBzaWduYXR1cmU6IEFQSUNsaWVudC5nZXRTaWduYXR1cmVVUkxcbiAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICh0YXNrLnRyYWNrKSB7XG4gICAgICB0aGlzLndyaXRlVHJhY2tzKHRhc2suaWQsIHRhc2sudGFibGUsIHRhc2sudHJhY2spO1xuICAgIH1cblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPCAxMCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbG9nKCdEb3dubG9hZGluZycsIHRhc2sudHlwZSwgdGFzay5pZCk7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICBpZiAob3V0cHV0TmFtZSA9PSBudWxsKSB7XG4gICAgICAgICAgbG9nKCdOb3QgRm91bmQnLCB1cmwpO1xuICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgbG9nKGV4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB3cml0ZVRyYWNrcyhpZCwgdGFibGUsIHRyYWNrSlNPTikge1xuICAgIGNvbnN0IHRyYWNrID0gbmV3IGNvcmUuVHJhY2soaWQsIEpTT04ucGFyc2UodHJhY2tKU09OKSk7XG5cbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dweCcsIHRyYWNrLCAndG9HUFgnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2ttbCcsIHRyYWNrLCAndG9LTUwnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ3NydCcsIHRyYWNrLCAndG9TUlQnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dlb2pzb24nLCB0cmFjaywgJ3RvR2VvSlNPTlN0cmluZycpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnanNvbicsIHRyYWNrLCAndG9KU09OU3RyaW5nJyk7XG4gIH1cblxuICB3cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsIGV4dGVuc2lvbiwgdHJhY2ssIG1ldGhvZCkge1xuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YWJsZSwgaWQgKyAnLicgKyBleHRlbnNpb24pO1xuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKG91dHB1dEZpbGVOYW1lKSB8fCBmcy5zdGF0U3luYyhvdXRwdXRGaWxlTmFtZSkuc2l6ZSA9PT0gMCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhvdXRwdXRGaWxlTmFtZSwgdHJhY2tbbWV0aG9kXSgpLnRvU3RyaW5nKCkpO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgZXJyb3IoJ2Vycm9yIHByb2Nlc3NpbmcgdHJhY2sgZmlsZScsIGV4dGVuc2lvbiwgaWQpO1xuICAgICAgICBlcnJvcihleCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsIHRhYmxlLCB0eXBlKSB7XG4gICAgbGV0IHRyYWNrQ29sdW1uID0gJ05VTEwgYXMgdHJhY2snO1xuXG4gICAgaWYgKHR5cGUgPT09ICd2aWRlbycgfHwgdHlwZSA9PT0gJ2F1ZGlvJykge1xuICAgICAgdHJhY2tDb2x1bW4gPSAndHJhY2snO1xuICAgIH1cblxuICAgIGF3YWl0IGFjY291bnQuZmluZEVhY2hCeVNRTChgU0VMRUNUIHJlc291cmNlX2lkLCAkeyB0cmFja0NvbHVtbiB9IEZST00gJHsgdGFibGUgfSBXSEVSRSBhY2NvdW50X2lkID0gJHsgYWNjb3VudC5yb3dJRCB9IEFORCBpc19zdG9yZWQgPSAxIEFORCBpc19kb3dubG9hZGVkID0gMGAsIG51bGwsICh7dmFsdWVzfSkgPT4ge1xuICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICB0aGlzLnF1ZXVlLnB1c2goe1xuICAgICAgICAgIHRva2VuOiBhY2NvdW50LnRva2VuLFxuICAgICAgICAgIHR5cGU6IHR5cGUsXG4gICAgICAgICAgdGFibGU6IHRhYmxlLFxuICAgICAgICAgIGlkOiB2YWx1ZXMucmVzb3VyY2VfaWQsXG4gICAgICAgICAgdHJhY2s6IHZhbHVlcy50cmFja1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGRvd25sb2FkV2l0aFJldHJpZXModXJsLCBvdXRwdXRGaWxlTmFtZSkge1xuICAgIGxldCB0cmllcyA9IDA7XG4gICAgY29uc3QgbWF4VHJpZXMgPSA1O1xuXG4gICAgd2hpbGUgKCsrdHJpZXMgPCBtYXhUcmllcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kb3dubG9hZCh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICByZXR1cm4gb3V0cHV0RmlsZU5hbWU7XG4gICAgICB9IGNhdGNoIChleCkge1xuICAgICAgICBpZiAoZXgubWVzc2FnZSA9PT0gJ25vdCBmb3VuZCcpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGVycm9yKCdGYWlsZWQnLCB1cmwsIGV4Lm1lc3NhZ2UsICdyZXRyeWluZy4uLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGRvd25sb2FkKHVybCwgdG8pIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVxID0gcmVxdWVzdFxuICAgICAgICAuZ2V0KHVybClcbiAgICAgICAgLm9uKCdyZXNwb25zZScsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgPT09IDQwNCkge1xuICAgICAgICAgICAgdGhpcy5hYm9ydCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdhYm9ydCcsICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ25vdCBmb3VuZCcpKSlcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKHJlcSkpXG4gICAgICAgIC5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIC5waXBlKGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHRvKSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==