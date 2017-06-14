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

      yield account.findEachBySQL(`SELECT resource_id, ${trackColumn} FROM ${table} WHERE is_downloaded = 0`, [], function ({ values }) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJjb25jdXJyZW5jeSIsIk1hdGgiLCJtaW4iLCJtYXgiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwiY29uc29sZSIsImVycm9yIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwidHJhY2siLCJ3cml0ZVRyYWNrcyIsImV4aXN0c1N5bmMiLCJzdGF0U3luYyIsInNpemUiLCJsb2ciLCJncmVlbiIsIm91dHB1dE5hbWUiLCJkb3dubG9hZFdpdGhSZXRyaWVzIiwicmVkIiwic3luYyIsImV4IiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJoYW5kbGVyIiwiZGlyIiwiZGVhY3RpdmF0ZSIsInRyYWNrSlNPTiIsIlRyYWNrIiwiSlNPTiIsInBhcnNlIiwid3JpdGVUcmFja0ZpbGUiLCJtZXRob2QiLCJ3cml0ZUZpbGVTeW5jIiwidG9TdHJpbmciLCJ0cmFja0NvbHVtbiIsImZpbmRFYWNoQnlTUUwiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJ0cmllcyIsIm1heFRyaWVzIiwiZG93bmxvYWQiLCJtZXNzYWdlIiwidG8iLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInJlcSIsImdldCIsIm9uIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiYWJvcnQiLCJFcnJvciIsInBpcGUiLCJjcmVhdGVXcml0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QUFwQyxFQUE2QyxhQUE3QztBQUNEO0FBQ0Y7QUFoQjRDO0FBaUI5Qzs7QUFFREQsV0FBU3JELEdBQVQsRUFBY3VELEVBQWQsRUFBa0I7QUFDaEIsV0FBTyxJQUFJQyxPQUFKLENBQVksQ0FBQ0MsT0FBRCxFQUFVQyxNQUFWLEtBQXFCO0FBQ3RDLFlBQU1DLE1BQU0sa0JBQ1RDLEdBRFMsQ0FDTDVELEdBREssRUFFVDZELEVBRlMsQ0FFTixVQUZNLEVBRU0sVUFBU0MsUUFBVCxFQUFtQjtBQUNqQyxZQUFJQSxTQUFTQyxVQUFULEtBQXdCLEdBQTVCLEVBQWlDO0FBQy9CLGVBQUtDLEtBQUw7QUFDRDtBQUNGLE9BTlMsRUFPVEgsRUFQUyxDQU9OLE9BUE0sRUFPRyxNQUFNSCxPQUFPLElBQUlPLEtBQUosQ0FBVSxXQUFWLENBQVAsQ0FQVCxFQVFUSixFQVJTLENBUU4sS0FSTSxFQVFDLE1BQU1KLFFBQVFFLEdBQVIsQ0FSUCxFQVNURSxFQVRTLENBU04sT0FUTSxFQVNHSCxNQVRILEVBVVRRLElBVlMsQ0FVSixhQUFHQyxpQkFBSCxDQUFxQlosRUFBckIsQ0FWSSxDQUFaO0FBV0QsS0FaTSxDQUFQO0FBYUQ7QUF6S2tCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgbWtkaXJwIGZyb20gJ21rZGlycCc7XG5pbXBvcnQgQ29uY3VycmVudFF1ZXVlIGZyb20gJy4vY29uY3VycmVudC1xdWV1ZSc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgQVBJQ2xpZW50LCBjb3JlIH0gZnJvbSAnZnVsY3J1bSc7XG5pbXBvcnQgcmVxdWVzdCBmcm9tICdyZXF1ZXN0JztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnbWVkaWEnLFxuICAgICAgZGVzYzogJ2Rvd25sb2FkIG1lZGlhJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBtZWRpYVBhdGg6IHtcbiAgICAgICAgICBkZXNjOiAnbWVkaWEgc3RvcmFnZSBkaXJlY3RvcnknLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmN1cnJlbmN5OiB7XG4gICAgICAgICAgZGVzYzogJ2NvbmN1cnJlbnQgZG93bmxvYWRzIChiZXR3ZWVuIDEgYW5kIDEwKScsXG4gICAgICAgICAgdHlwZTogJ251bWJlcidcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgY29uY3VycmVuY3kgPSBNYXRoLm1pbihNYXRoLm1heCgxLCBmdWxjcnVtLmFyZ3MuY29uY3VycmVuY3kgfHwgNSksIDEwKTtcblxuICAgICAgdGhpcy5xdWV1ZSA9IG5ldyBDb25jdXJyZW50UXVldWUodGhpcy53b3JrZXIsIGNvbmN1cnJlbmN5KTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3Bob3RvcycsICdwaG90bycpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3NpZ25hdHVyZXMnLCAnc2lnbmF0dXJlJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAnYXVkaW8nLCAnYXVkaW8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICd2aWRlb3MnLCAndmlkZW8nKTtcblxuICAgICAgYXdhaXQgdGhpcy5xdWV1ZS5kcmFpbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdVbmFibGUgdG8gZmluZCBhY2NvdW50JywgZnVsY3J1bS5hcmdzLm9yZyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGUoKSB7XG4gICAgdGhpcy5tZWRpYVBhdGggPSBmdWxjcnVtLmFyZ3MubWVkaWFQYXRoIHx8IGZ1bGNydW0uZGlyKCdtZWRpYScpO1xuXG4gICAgbWtkaXJwLnN5bmModGhpcy5tZWRpYVBhdGgpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3Bob3RvcycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICd2aWRlb3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAnYXVkaW8nKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAnc2lnbmF0dXJlcycpKTtcblxuICAgIC8vIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgLy8gZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gIH1cblxuICB3b3JrZXIgPSBhc3luYyAodGFzaykgPT4ge1xuICAgIGNvbnN0IHVybCA9IHtcbiAgICAgIHBob3RvOiBBUElDbGllbnQuZ2V0UGhvdG9VUkwsXG4gICAgICB2aWRlbzogQVBJQ2xpZW50LmdldFZpZGVvVVJMLFxuICAgICAgYXVkaW86IEFQSUNsaWVudC5nZXRBdWRpb1VSTCxcbiAgICAgIHNpZ25hdHVyZTogQVBJQ2xpZW50LmdldFNpZ25hdHVyZVVSTFxuICAgIH1bdGFzay50eXBlXS5iaW5kKEFQSUNsaWVudCkoe3Rva2VuOiB0YXNrLnRva2VufSwgdGFzayk7XG5cbiAgICBjb25zdCBleHRlbnNpb24gPSB7XG4gICAgICBwaG90bzogJ2pwZycsXG4gICAgICB2aWRlbzogJ21wNCcsXG4gICAgICBhdWRpbzogJ200YScsXG4gICAgICBzaWduYXR1cmU6ICdwbmcnXG4gICAgfVt0YXNrLnR5cGVdO1xuXG4gICAgY29uc3Qgb3V0cHV0RmlsZU5hbWUgPSBwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsIHRhc2sudGFibGUsIHRhc2suaWQgKyAnLicgKyBleHRlbnNpb24pO1xuXG4gICAgaWYgKHRhc2sudHJhY2spIHtcbiAgICAgIHRoaXMud3JpdGVUcmFja3ModGFzay5pZCwgdGFzay50YWJsZSwgdGFzay50cmFjayk7XG4gICAgfVxuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKG91dHB1dEZpbGVOYW1lKSB8fCBmcy5zdGF0U3luYyhvdXRwdXRGaWxlTmFtZSkuc2l6ZSA8IDEwMDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdEb3dubG9hZGluZycsIHRhc2sudHlwZS5ncmVlbiwgdGFzay5pZCk7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICBpZiAob3V0cHV0TmFtZSA9PSBudWxsKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ05vdCBGb3VuZCcucmVkLCB1cmwpO1xuICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgY29uc29sZS5sb2coZXgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHdyaXRlVHJhY2tzKGlkLCB0YWJsZSwgdHJhY2tKU09OKSB7XG4gICAgY29uc3QgdHJhY2sgPSBuZXcgY29yZS5UcmFjayhpZCwgSlNPTi5wYXJzZSh0cmFja0pTT04pKTtcblxuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnZ3B4JywgdHJhY2ssICd0b0dQWCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAna21sJywgdHJhY2ssICd0b0tNTCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnc3J0JywgdHJhY2ssICd0b1NSVCcpO1xuICAgIHRoaXMud3JpdGVUcmFja0ZpbGUoaWQsIHRhYmxlLCAnZ2VvanNvbicsIHRyYWNrLCAndG9HZW9KU09OU3RyaW5nJyk7XG4gICAgdGhpcy53cml0ZVRyYWNrRmlsZShpZCwgdGFibGUsICdqc29uJywgdHJhY2ssICd0b0pTT05TdHJpbmcnKTtcbiAgfVxuXG4gIHdyaXRlVHJhY2tGaWxlKGlkLCB0YWJsZSwgZXh0ZW5zaW9uLCB0cmFjaywgbWV0aG9kKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZU5hbWUgPSBwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsIHRhYmxlLCBpZCArICcuJyArIGV4dGVuc2lvbik7XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMob3V0cHV0RmlsZU5hbWUpIHx8IGZzLnN0YXRTeW5jKG91dHB1dEZpbGVOYW1lKS5zaXplID09PSAwKSB7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKG91dHB1dEZpbGVOYW1lLCB0cmFja1ttZXRob2RdKCkudG9TdHJpbmcoKSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsIHRhYmxlLCB0eXBlKSB7XG4gICAgbGV0IHRyYWNrQ29sdW1uID0gJ05VTEwgYXMgdHJhY2snO1xuXG4gICAgaWYgKHR5cGUgPT09ICd2aWRlbycgfHwgdHlwZSA9PT0gJ2F1ZGlvJykge1xuICAgICAgdHJhY2tDb2x1bW4gPSAndHJhY2snO1xuICAgIH1cblxuICAgIGF3YWl0IGFjY291bnQuZmluZEVhY2hCeVNRTChgU0VMRUNUIHJlc291cmNlX2lkLCAkeyB0cmFja0NvbHVtbiB9IEZST00gJHsgdGFibGUgfSBXSEVSRSBpc19kb3dubG9hZGVkID0gMGAsIFtdLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICB0b2tlbjogYWNjb3VudC50b2tlbixcbiAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgIHRhYmxlOiB0YWJsZSxcbiAgICAgICAgICBpZDogdmFsdWVzLnJlc291cmNlX2lkLFxuICAgICAgICAgIHRyYWNrOiB2YWx1ZXMudHJhY2tcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkb3dubG9hZFdpdGhSZXRyaWVzKHVybCwgb3V0cHV0RmlsZU5hbWUpIHtcbiAgICBsZXQgdHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFRyaWVzID0gNTtcblxuICAgIHdoaWxlICgrK3RyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZG93bmxvYWQodXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEZpbGVOYW1lO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgaWYgKGV4Lm1lc3NhZ2UgPT09ICdub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQnLnJlZCwgdXJsLCBleC5tZXNzYWdlLCAncmV0cnlpbmcuLi4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkb3dubG9hZCh1cmwsIHRvKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcSA9IHJlcXVlc3RcbiAgICAgICAgLmdldCh1cmwpXG4gICAgICAgIC5vbigncmVzcG9uc2UnLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICAgICAgICAgIHRoaXMuYWJvcnQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5vbignYWJvcnQnLCAoKSA9PiByZWplY3QobmV3IEVycm9yKCdub3QgZm91bmQnKSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShyZXEpKVxuICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAucGlwZShmcy5jcmVhdGVXcml0ZVN0cmVhbSh0bykpO1xuICAgIH0pO1xuICB9XG59XG4iXX0=