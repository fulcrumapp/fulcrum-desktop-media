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
        _this.queue = new _concurrentQueue2.default(_this.worker);

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
        }[task.type].bind(_fulcrumDesktopPlugin.APIClient)(task.account, task);

        const extension = {
          photo: 'jpg',
          video: 'mp4',
          audio: 'm4a',
          signature: 'png'
        }[task.type];

        const outputFileName = _path2.default.join(_this.mediaPath, task.table, task.id + '.' + extension);

        if (!_fs2.default.existsSync(outputFileName) || _fs2.default.statSync(outputFileName).size === 0) {
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

  queueMediaDownload(account, table, type) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      yield account.findEachBySQL(`SELECT resource_id FROM ${table} WHERE is_downloaded = 0`, [], function ({ values }) {
        if (values) {
          _this4.queue.push({
            account,
            type: type,
            table: table,
            id: values.resource_id
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
      const rq = (0, _request2.default)(url).on('response', function (response) {
        if (response.statusCode !== 200) {
          this.abort();
        }
      }).on('abort', () => reject(new Error('not found'))).on('close', () => resolve(rq)).on('error', reject).pipe(_fs2.default.createWriteStream(to));
    });
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwiY29uc29sZSIsImVycm9yIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwiZXh0ZW5zaW9uIiwib3V0cHV0RmlsZU5hbWUiLCJqb2luIiwibWVkaWFQYXRoIiwidGFibGUiLCJpZCIsImV4aXN0c1N5bmMiLCJzdGF0U3luYyIsInNpemUiLCJsb2ciLCJncmVlbiIsIm91dHB1dE5hbWUiLCJkb3dubG9hZFdpdGhSZXRyaWVzIiwicmVkIiwic3luYyIsImV4IiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJoYW5kbGVyIiwiZGlyIiwiZGVhY3RpdmF0ZSIsImZpbmRFYWNoQnlTUUwiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJ0cmllcyIsIm1heFRyaWVzIiwiZG93bmxvYWQiLCJtZXNzYWdlIiwidG8iLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInJxIiwib24iLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJhYm9ydCIsIkVycm9yIiwicGlwZSIsImNyZWF0ZVdyaXRlU3RyZWFtIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOzs7O0FBQ0E7Ozs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBb0JuQkEsVUFwQm1CLHFCQW9CTixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVB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QUEyQjtBQUN6QixZQUFJO0FBQ0YsZ0JBQU0sT0FBS0MsUUFBTCxDQUFjekMsR0FBZCxFQUFtQlksY0FBbkIsQ0FBTjs7QUFFQSxpQkFBT0EsY0FBUDtBQUNELFNBSkQsQ0FJRSxPQUFPYyxFQUFQLEVBQVc7QUFDWCxjQUFJQSxHQUFHZ0IsT0FBSCxLQUFlLFdBQW5CLEVBQWdDO0FBQzlCLG1CQUFPLElBQVA7QUFDRDs7QUFFRDdDLGtCQUFRQyxLQUFSLENBQWMsU0FBUzBCLEdBQXZCLEVBQTRCeEIsR0FBNUIsRUFBaUMwQixHQUFHZ0IsT0FBcEMsRUFBNkMsYUFBN0M7QUFDRDtBQUNGO0FBaEI0QztBQWlCOUM7O0FBRURELFdBQVN6QyxHQUFULEVBQWMyQyxFQUFkLEVBQWtCO0FBQ2hCLFdBQU8sSUFBSUMsT0FBSixDQUFZLENBQUNDLE9BQUQsRUFBVUMsTUFBVixLQUFxQjtBQUN0QyxZQUFNQyxLQUNKLHVCQUFRL0MsR0FBUixFQUNHZ0QsRUFESCxDQUNNLFVBRE4sRUFDa0IsVUFBVUMsUUFBVixFQUFvQjtBQUNsQyxZQUFJQSxTQUFTQyxVQUFULEtBQXdCLEdBQTVCLEVBQWlDO0FBQy9CLGVBQUtDLEtBQUw7QUFDRDtBQUNGLE9BTEgsRUFNR0gsRUFOSCxDQU1NLE9BTk4sRUFNZSxNQUFNRixPQUFPLElBQUlNLEtBQUosQ0FBVSxXQUFWLENBQVAsQ0FOckIsRUFPR0osRUFQSCxDQU9NLE9BUE4sRUFPZSxNQUFNSCxRQUFRRSxFQUFSLENBUHJCLEVBUUdDLEVBUkgsQ0FRTSxPQVJOLEVBUWVGLE1BUmYsRUFTR08sSUFUSCxDQVNRLGFBQUdDLGlCQUFILENBQXFCWCxFQUFyQixDQVRSLENBREY7QUFXRCxLQVpNLENBQVA7QUFhRDtBQXRJa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBta2RpcnAgZnJvbSAnbWtkaXJwJztcbmltcG9ydCBDb25jdXJyZW50UXVldWUgZnJvbSAnLi9jb25jdXJyZW50LXF1ZXVlJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgeyBBUElDbGllbnQgfSBmcm9tICdmdWxjcnVtJztcbmltcG9ydCByZXF1ZXN0IGZyb20gJ3JlcXVlc3QnO1xuaW1wb3J0IHJpbXJhZiBmcm9tICdyaW1yYWYnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdtZWRpYScsXG4gICAgICBkZXNjOiAnZG93bmxvYWQgbWVkaWEnLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdtZWRpYSBzdG9yYWdlIGRpcmVjdG9yeScsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgdGhpcy5xdWV1ZSA9IG5ldyBDb25jdXJyZW50UXVldWUodGhpcy53b3JrZXIpO1xuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAncGhvdG9zJywgJ3Bob3RvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAnc2lnbmF0dXJlcycsICdzaWduYXR1cmUnKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdhdWRpbycsICdhdWRpbycpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ3ZpZGVvcycsICd2aWRlbycpO1xuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlLmRyYWluKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICB0aGlzLm1lZGlhUGF0aCA9IGZ1bGNydW0uYXJncy5tZWRpYVBhdGggfHwgZnVsY3J1bS5kaXIoJ21lZGlhJyk7XG5cbiAgICBta2RpcnAuc3luYyh0aGlzLm1lZGlhUGF0aCk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAncGhvdG9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3ZpZGVvcycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdhdWRpbycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdzaWduYXR1cmVzJykpO1xuXG4gICAgLy8gZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICAvLyBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgfVxuXG4gIHdvcmtlciA9IGFzeW5jICh0YXNrKSA9PiB7XG4gICAgY29uc3QgdXJsID0ge1xuICAgICAgcGhvdG86IEFQSUNsaWVudC5nZXRQaG90b1VSTCxcbiAgICAgIHZpZGVvOiBBUElDbGllbnQuZ2V0VmlkZW9VUkwsXG4gICAgICBhdWRpbzogQVBJQ2xpZW50LmdldEF1ZGlvVVJMLFxuICAgICAgc2lnbmF0dXJlOiBBUElDbGllbnQuZ2V0U2lnbmF0dXJlVVJMXG4gICAgfVt0YXNrLnR5cGVdLmJpbmQoQVBJQ2xpZW50KSh0YXNrLmFjY291bnQsIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPT09IDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdEb3dubG9hZGluZycsIHRhc2sudHlwZS5ncmVlbiwgdGFzay5pZCk7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICBpZiAob3V0cHV0TmFtZSA9PSBudWxsKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ05vdCBGb3VuZCcucmVkLCB1cmwpO1xuICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgY29uc29sZS5sb2coZXgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCB0YWJsZSwgdHlwZSkge1xuICAgIGF3YWl0IGFjY291bnQuZmluZEVhY2hCeVNRTChgU0VMRUNUIHJlc291cmNlX2lkIEZST00gJHsgdGFibGUgfSBXSEVSRSBpc19kb3dubG9hZGVkID0gMGAsIFtdLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICBhY2NvdW50LFxuICAgICAgICAgIHR5cGU6IHR5cGUsXG4gICAgICAgICAgdGFibGU6IHRhYmxlLFxuICAgICAgICAgIGlkOiB2YWx1ZXMucmVzb3VyY2VfaWRcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkb3dubG9hZFdpdGhSZXRyaWVzKHVybCwgb3V0cHV0RmlsZU5hbWUpIHtcbiAgICBsZXQgdHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFRyaWVzID0gNTtcblxuICAgIHdoaWxlICgrK3RyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZG93bmxvYWQodXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEZpbGVOYW1lO1xuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgaWYgKGV4Lm1lc3NhZ2UgPT09ICdub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQnLnJlZCwgdXJsLCBleC5tZXNzYWdlLCAncmV0cnlpbmcuLi4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkb3dubG9hZCh1cmwsIHRvKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJxID1cbiAgICAgICAgcmVxdWVzdCh1cmwpXG4gICAgICAgICAgLm9uKCdyZXNwb25zZScsIGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgIT09IDIwMCkge1xuICAgICAgICAgICAgICB0aGlzLmFib3J0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2Fib3J0JywgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignbm90IGZvdW5kJykpKVxuICAgICAgICAgIC5vbignY2xvc2UnLCAoKSA9PiByZXNvbHZlKHJxKSlcbiAgICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAgIC5waXBlKGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHRvKSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==