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
        const concurrency = Math.min(Math.max(1, fulcrum.args.mediaConcurrency || 5), 10);

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
        console.log(ex);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJjb25jdXJyZW5jeSIsIk1hdGgiLCJtaW4iLCJtYXgiLCJtZWRpYUNvbmN1cnJlbmN5IiwicXVldWUiLCJ3b3JrZXIiLCJxdWV1ZU1lZGlhRG93bmxvYWQiLCJkcmFpbiIsImNvbnNvbGUiLCJlcnJvciIsInRhc2siLCJ1cmwiLCJwaG90byIsImdldFBob3RvVVJMIiwidmlkZW8iLCJnZXRWaWRlb1VSTCIsImF1ZGlvIiwiZ2V0QXVkaW9VUkwiLCJzaWduYXR1cmUiLCJnZXRTaWduYXR1cmVVUkwiLCJ0eXBlIiwiYmluZCIsInRva2VuIiwiZXh0ZW5zaW9uIiwib3V0cHV0RmlsZU5hbWUiLCJqb2luIiwibWVkaWFQYXRoIiwidGFibGUiLCJpZCIsInRyYWNrIiwid3JpdGVUcmFja3MiLCJleGlzdHNTeW5jIiwic3RhdFN5bmMiLCJzaXplIiwibG9nIiwiZ3JlZW4iLCJvdXRwdXROYW1lIiwiZG93bmxvYWRXaXRoUmV0cmllcyIsInJlZCIsInN5bmMiLCJleCIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwiaGFuZGxlciIsImRpciIsImRlYWN0aXZhdGUiLCJ0cmFja0pTT04iLCJUcmFjayIsIkpTT04iLCJwYXJzZSIsIndyaXRlVHJhY2tGaWxlIiwibWV0aG9kIiwid3JpdGVGaWxlU3luYyIsInRvU3RyaW5nIiwidHJhY2tDb2x1bW4iLCJmaW5kRWFjaEJ5U1FMIiwicm93SUQiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJ0cmllcyIsIm1heFRyaWVzIiwiZG93bmxvYWQiLCJtZXNzYWdlIiwidG8iLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInJlcSIsImdldCIsIm9uIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiYWJvcnQi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QUNYLGNBQUlBLEdBQUcwQixPQUFILEtBQWUsV0FBbkIsRUFBZ0M7QUFDOUIsbUJBQU8sSUFBUDtBQUNEOztBQUVEMUQsa0JBQVFDLEtBQVIsQ0FBYyxTQUFTNkIsR0FBdkIsRUFBNEIzQixHQUE1QixFQUFpQzZCLEdBQUcwQixPQUFwQyxFQUE2QyxhQUE3QztBQUNEO0FBQ0Y7QUFoQjRDO0FBaUI5Qzs7QUFFREQsV0FBU3RELEdBQVQsRUFBY3dELEVBQWQsRUFBa0I7QUFDaEIsV0FBTyxJQUFJQyxPQUFKLENBQVksQ0FBQ0MsT0FBRCxFQUFVQyxNQUFWLEtBQXFCO0FBQ3RDLFlBQU1DLE1BQU0sa0JBQ1RDLEdBRFMsQ0FDTDdELEdBREssRUFFVDhELEVBRlMsQ0FFTixVQUZNLEVBRU0sVUFBU0MsUUFBVCxFQUFtQjtBQUNqQyxZQUFJQSxTQUFTQyxVQUFULEtBQXdCLEdBQTVCLEVBQWlDO0FBQy9CLGVBQUtDLEtBQUw7QUFDRDtBQUNGLE9BTlMsRUFPVEgsRUFQUyxDQU9OLE9BUE0sRUFPRyxNQUFNSCxPQUFPLElBQUlPLEtBQUosQ0FBVSxXQUFWLENBQVAsQ0FQVCxFQVFUSixFQVJTLENBUU4sS0FSTSxFQVFDLE1BQU1KLFFBQVFFLEdBQVIsQ0FSUCxFQVNURSxFQVRTLENBU04sT0FUTSxFQVNHSCxNQVRILEVBVVRRLElBVlMsQ0FVSixhQUFHQyxpQkFBSCxDQUFxQlosRUFBckIsQ0FWSSxDQUFaO0FBV0QsS0FaTSxDQUFQO0FBYUQ7QUE3S2tCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgbWtkaXJwIGZyb20gJ21rZGlycCc7XG5pbXBvcnQgQ29uY3VycmVudFF1ZXVlIGZyb20gJy4vY29uY3VycmVudC1xdWV1ZSc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgQVBJQ2xpZW50LCBjb3JlIH0gZnJvbSAnZnVsY3J1bSc7XG5pbXBvcnQgcmVxdWVzdCBmcm9tICdyZXF1ZXN0JztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnbWVkaWEnLFxuICAgICAgZGVzYzogJ2Rvd25sb2FkIG1lZGlhJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBtZWRpYVBhdGg6IHtcbiAgICAgICAgICBkZXNjOiAnbWVkaWEgc3RvcmFnZSBkaXJlY3RvcnknLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhQ29uY3VycmVuY3k6IHtcbiAgICAgICAgICBkZXNjOiAnY29uY3VycmVudCBkb3dubG9hZHMgKGJldHdlZW4gMSBhbmQgMTApJyxcbiAgICAgICAgICB0eXBlOiAnbnVtYmVyJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeSA9IE1hdGgubWluKE1hdGgubWF4KDEsIGZ1bGNydW0uYXJncy5tZWRpYUNvbmN1cnJlbmN5IHx8IDUpLCAxMCk7XG5cbiAgICAgIHRoaXMucXVldWUgPSBuZXcgQ29uY3VycmVudFF1ZXVlKHRoaXMud29ya2VyLCBjb25jdXJyZW5jeSk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdwaG90b3MnLCAncGhvdG8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdzaWduYXR1cmVzJywgJ3NpZ25hdHVyZScpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ2F1ZGlvJywgJ2F1ZGlvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAndmlkZW9zJywgJ3ZpZGVvJyk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWUuZHJhaW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIHRoaXMubWVkaWFQYXRoID0gZnVsY3J1bS5hcmdzLm1lZGlhUGF0aCB8fCBmdWxjcnVtLmRpcignbWVkaWEnKTtcblxuICAgIG1rZGlycC5zeW5jKHRoaXMubWVkaWFQYXRoKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdwaG90b3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAndmlkZW9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ2F1ZGlvJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3NpZ25hdHVyZXMnKSk7XG5cbiAgICAvLyBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIC8vIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICB9XG5cbiAgd29ya2VyID0gYXN5bmMgKHRhc2spID0+IHtcbiAgICBjb25zdCB1cmwgPSB7XG4gICAgICBwaG90bzogQVBJQ2xpZW50LmdldFBob3RvVVJMLFxuICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgIGF1ZGlvOiBBUElDbGllbnQuZ2V0QXVkaW9VUkwsXG4gICAgICBzaWduYXR1cmU6IEFQSUNsaWVudC5nZXRTaWduYXR1cmVVUkxcbiAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICh0YXNrLnRyYWNrKSB7XG4gICAgICB0aGlzLndyaXRlVHJhY2tzKHRhc2suaWQsIHRhc2sudGFibGUsIHRhc2sudHJhY2spO1xuICAgIH1cblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPCAxMDAwKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnRG93bmxvYWRpbmcnLCB0YXNrLnR5cGUuZ3JlZW4sIHRhc2suaWQpO1xuXG4gICAgICAgIGNvbnN0IG91dHB1dE5hbWUgPSBhd2FpdCB0aGlzLmRvd25sb2FkV2l0aFJldHJpZXModXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgaWYgKG91dHB1dE5hbWUgPT0gbnVsbCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdOb3QgRm91bmQnLnJlZCwgdXJsKTtcbiAgICAgICAgICByaW1yYWYuc3luYyhvdXRwdXRGaWxlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGV4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB3cml0ZVRyYWNrcyhpZCwgdGFibGUsIHRyYWNrSlNPTikge1xuICAgIGNvbnN0IHRyYWNrID0gbmV3IGNvcmUuVHJhY2soaWQsIEpTT04ucGFyc2UodHJhY2tKU09OKSk7XG5cbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dweCcsIHRyYWNrLCAndG9HUFgnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2ttbCcsIHRyYWNrLCAndG9LTUwnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ3NydCcsIHRyYWNrLCAndG9TUlQnKTtcbiAgICB0aGlzLndyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgJ2dlb2pzb24nLCB0cmFjaywgJ3RvR2VvSlNPTlN0cmluZycpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnanNvbicsIHRyYWNrLCAndG9KU09OU3RyaW5nJyk7XG4gIH1cblxuICB3cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsIGV4dGVuc2lvbiwgdHJhY2ssIG1ldGhvZCkge1xuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YWJsZSwgaWQgKyAnLicgKyBleHRlbnNpb24pO1xuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKG91dHB1dEZpbGVOYW1lKSB8fCBmcy5zdGF0U3luYyhvdXRwdXRGaWxlTmFtZSkuc2l6ZSA9PT0gMCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhvdXRwdXRGaWxlTmFtZSwgdHJhY2tbbWV0aG9kXSgpLnRvU3RyaW5nKCkpO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgY29uc29sZS5sb2coZXgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCB0YWJsZSwgdHlwZSkge1xuICAgIGxldCB0cmFja0NvbHVtbiA9ICdOVUxMIGFzIHRyYWNrJztcblxuICAgIGlmICh0eXBlID09PSAndmlkZW8nIHx8IHR5cGUgPT09ICdhdWRpbycpIHtcbiAgICAgIHRyYWNrQ29sdW1uID0gJ3RyYWNrJztcbiAgICB9XG5cbiAgICBhd2FpdCBhY2NvdW50LmZpbmRFYWNoQnlTUUwoYFNFTEVDVCByZXNvdXJjZV9pZCwgJHsgdHJhY2tDb2x1bW4gfSBGUk9NICR7IHRhYmxlIH0gV0hFUkUgYWNjb3VudF9pZCA9ICR7IGFjY291bnQucm93SUQgfSBBTkQgaXNfc3RvcmVkID0gMSBBTkQgaXNfZG93bmxvYWRlZCA9IDBgLCBudWxsLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICB0b2tlbjogYWNjb3VudC50b2tlbixcbiAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgIHRhYmxlOiB0YWJsZSxcbiAgICAgICAgICBpZDogdmFsdWVzLnJlc291cmNlX2lkLFxuICAgICAgICAgIHRyYWNrOiB2YWx1ZXMudHJhY2tcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkb3dubG9hZFdpdGhSZXRyaWVzKHVybCwgb3V0cHV0RmlsZU5hbWUpIHtcbiAgICBsZXQgdHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFRyaWVzID0gNTtcblxuICAgIHdoaWxlICgrK3RyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZG93bmxvYWQodXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEZpbGVOYW1lO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgaWYgKGV4Lm1lc3NhZ2UgPT09ICdub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQnLnJlZCwgdXJsLCBleC5tZXNzYWdlLCAncmV0cnlpbmcuLi4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkb3dubG9hZCh1cmwsIHRvKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcSA9IHJlcXVlc3RcbiAgICAgICAgLmdldCh1cmwpXG4gICAgICAgIC5vbigncmVzcG9uc2UnLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICAgICAgICAgIHRoaXMuYWJvcnQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5vbignYWJvcnQnLCAoKSA9PiByZWplY3QobmV3IEVycm9yKCdub3QgZm91bmQnKSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShyZXEpKVxuICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAucGlwZShmcy5jcmVhdGVXcml0ZVN0cmVhbSh0bykpO1xuICAgIH0pO1xuICB9XG59XG4iXX0=