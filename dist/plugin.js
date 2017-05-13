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

var _levelup = require('levelup');

var _levelup2 = _interopRequireDefault(_levelup);

var _tempy = require('tempy');

var _tempy2 = _interopRequireDefault(_tempy);

var _levelJobs = require('level-jobs');

var _levelJobs2 = _interopRequireDefault(_levelJobs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

exports.default = class {
  constructor() {
    var _this = this;

    this.runCommand = _asyncToGenerator(function* () {
      yield _this.activate();

      const account = yield fulcrum.fetchAccount(fulcrum.args.org);

      if (account) {
        // this.queue = new ConcurrentQueue(this.worker);

        const queueFile = _tempy2.default.file({ extension: 'db' });

        _this.queueDatabase = (0, _levelup2.default)(queueFile);
        _this.queue = (0, _levelJobs2.default)(_this.queueDatabase, function (task, cb) {
          _this.worker(task).then(cb, cb);
        }, 5);

        yield _this.queueMediaDownload(account, 'photos', 'photo');
        yield _this.queueMediaDownload(account, 'signatures', 'signature');
        yield _this.queueMediaDownload(account, 'audio', 'audio');
        yield _this.queueMediaDownload(account, 'videos', 'video');

        // await this.queue.drain();

        yield new Promise(function (resolve, reject) {
          _this.queue.on('drain', resolve);
        });
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

        console.log('WORK', url);

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
            token: account.token,
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
      // await APIClient.download(url, outputFileName);
      yield _this5.download(url, outputFileName);
      return outputFileName;

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
      const rq = (0, _request2.default)(url).pipe(_fs2.default.createWriteStream(to));

      rq.on('response', function (response) {
        if (response.statusCode !== 200) {
          this.abort();
        }
      }).on('abort', () => reject(new Error('not found'))).on('close', () => resolve(rq)).on('error', reject);
      // rq.on('close', () => resolve(rq));
      // rq.on('error', reject);
    });

    return new Promise((resolve, reject) => {
      const rq = (0, _request2.default)(url).on('response', function (response) {
        if (response.statusCode !== 200) {
          this.abort();
        }
      }).on('abort', () => reject(new Error('not found'))).on('close', () => resolve(rq)).on('error', reject).pipe(_fs2.default.createWriteStream(to));
    });
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJxdWV1ZUZpbGUiLCJmaWxlIiwiZXh0ZW5zaW9uIiwicXVldWVEYXRhYmFzZSIsInF1ZXVlIiwidGFzayIsImNiIiwid29ya2VyIiwidGhlbiIsInF1ZXVlTWVkaWFEb3dubG9hZCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwib24iLCJjb25zb2xlIiwiZXJyb3IiLCJ1cmwiLCJwaG90byIsImdldFBob3RvVVJMIiwidmlkZW8iLCJnZXRWaWRlb1VSTCIsImF1ZGlvIiwiZ2V0QXVkaW9VUkwiLCJzaWduYXR1cmUiLCJnZXRTaWduYXR1cmVVUkwiLCJ0eXBlIiwiYmluZCIsInRva2VuIiwibG9nIiwib3V0cHV0RmlsZU5hbWUiLCJqb2luIiwibWVkaWFQYXRoIiwidGFibGUiLCJpZCIsImV4aXN0c1N5bmMiLCJzdGF0U3luYyIsInNpemUiLCJncmVlbiIsIm91dHB1dE5hbWUiLCJkb3dubG9hZFdpdGhSZXRyaWVzIiwicmVkIiwic3luYyIsImV4IiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJoYW5kbGVyIiwiZGlyIiwiZGVhY3RpdmF0ZSIsImZpbmRFYWNoQnlTUUwiLCJ2YWx1ZXMiLCJwdXNoIiwicmVzb3VyY2VfaWQiLCJkb3dubG9hZCIsInRyaWVzIiwibWF4VHJpZXMiLCJtZXNzYWdlIiwidG8iLCJycSIsInBpcGUiLCJjcmVhdGVXcml0ZVN0cmVhbSIsInJlc3BvbnNlIiwic3RhdHVzQ29kZSIsImFib3J0IiwiRXJyb3IiXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7Ozs7a0JBRWUsTUFBTTtBQUFB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IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgbWtkaXJwIGZyb20gJ21rZGlycCc7XG5pbXBvcnQgQ29uY3VycmVudFF1ZXVlIGZyb20gJy4vY29uY3VycmVudC1xdWV1ZSc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgQVBJQ2xpZW50IH0gZnJvbSAnZnVsY3J1bSc7XG5pbXBvcnQgcmVxdWVzdCBmcm9tICdyZXF1ZXN0JztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcbmltcG9ydCBsZXZlbHVwIGZyb20gJ2xldmVsdXAnO1xuaW1wb3J0IHRlbXB5IGZyb20gJ3RlbXB5JztcbmltcG9ydCBKb2JzIGZyb20gJ2xldmVsLWpvYnMnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdtZWRpYScsXG4gICAgICBkZXNjOiAnZG93bmxvYWQgbWVkaWEnLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIG1lZGlhUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdtZWRpYSBzdG9yYWdlIGRpcmVjdG9yeScsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgLy8gdGhpcy5xdWV1ZSA9IG5ldyBDb25jdXJyZW50UXVldWUodGhpcy53b3JrZXIpO1xuXG4gICAgICBjb25zdCBxdWV1ZUZpbGUgPSB0ZW1weS5maWxlKHtleHRlbnNpb246ICdkYid9KTtcblxuICAgICAgdGhpcy5xdWV1ZURhdGFiYXNlID0gbGV2ZWx1cChxdWV1ZUZpbGUpO1xuICAgICAgdGhpcy5xdWV1ZSA9IEpvYnModGhpcy5xdWV1ZURhdGFiYXNlLCAodGFzaywgY2IpID0+IHtcbiAgICAgICAgdGhpcy53b3JrZXIodGFzaykudGhlbihjYiwgY2IpO1xuICAgICAgfSwgNSk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdwaG90b3MnLCAncGhvdG8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdzaWduYXR1cmVzJywgJ3NpZ25hdHVyZScpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ2F1ZGlvJywgJ2F1ZGlvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAndmlkZW9zJywgJ3ZpZGVvJyk7XG5cbiAgICAgIC8vIGF3YWl0IHRoaXMucXVldWUuZHJhaW4oKTtcblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICB0aGlzLnF1ZXVlLm9uKCdkcmFpbicsIHJlc29sdmUpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICB0aGlzLm1lZGlhUGF0aCA9IGZ1bGNydW0uYXJncy5tZWRpYVBhdGggfHwgZnVsY3J1bS5kaXIoJ21lZGlhJyk7XG5cbiAgICBta2RpcnAuc3luYyh0aGlzLm1lZGlhUGF0aCk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAncGhvdG9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3ZpZGVvcycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdhdWRpbycpKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdzaWduYXR1cmVzJykpO1xuXG4gICAgLy8gZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICAvLyBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgfVxuXG4gIHdvcmtlciA9IGFzeW5jICh0YXNrKSA9PiB7XG4gICAgY29uc3QgdXJsID0ge1xuICAgICAgcGhvdG86IEFQSUNsaWVudC5nZXRQaG90b1VSTCxcbiAgICAgIHZpZGVvOiBBUElDbGllbnQuZ2V0VmlkZW9VUkwsXG4gICAgICBhdWRpbzogQVBJQ2xpZW50LmdldEF1ZGlvVVJMLFxuICAgICAgc2lnbmF0dXJlOiBBUElDbGllbnQuZ2V0U2lnbmF0dXJlVVJMXG4gICAgfVt0YXNrLnR5cGVdLmJpbmQoQVBJQ2xpZW50KSh7dG9rZW46IHRhc2sudG9rZW59LCB0YXNrKTtcblxuICAgIGNvbnNvbGUubG9nKCdXT1JLJywgdXJsKTtcblxuICAgIGNvbnN0IGV4dGVuc2lvbiA9IHtcbiAgICAgIHBob3RvOiAnanBnJyxcbiAgICAgIHZpZGVvOiAnbXA0JyxcbiAgICAgIGF1ZGlvOiAnbTRhJyxcbiAgICAgIHNpZ25hdHVyZTogJ3BuZydcbiAgICB9W3Rhc2sudHlwZV07XG5cbiAgICBjb25zdCBvdXRwdXRGaWxlTmFtZSA9IHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgdGFzay50YWJsZSwgdGFzay5pZCArICcuJyArIGV4dGVuc2lvbik7XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMob3V0cHV0RmlsZU5hbWUpIHx8IGZzLnN0YXRTeW5jKG91dHB1dEZpbGVOYW1lKS5zaXplID09PSAwKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnRG93bmxvYWRpbmcnLCB0YXNrLnR5cGUuZ3JlZW4sIHRhc2suaWQpO1xuXG4gICAgICAgIGNvbnN0IG91dHB1dE5hbWUgPSBhd2FpdCB0aGlzLmRvd25sb2FkV2l0aFJldHJpZXModXJsLCBvdXRwdXRGaWxlTmFtZSk7XG5cbiAgICAgICAgaWYgKG91dHB1dE5hbWUgPT0gbnVsbCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdOb3QgRm91bmQnLnJlZCwgdXJsKTtcbiAgICAgICAgICByaW1yYWYuc3luYyhvdXRwdXRGaWxlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGV4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBxdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgdGFibGUsIHR5cGUpIHtcbiAgICBhd2FpdCBhY2NvdW50LmZpbmRFYWNoQnlTUUwoYFNFTEVDVCByZXNvdXJjZV9pZCBGUk9NICR7IHRhYmxlIH0gV0hFUkUgaXNfZG93bmxvYWRlZCA9IDBgLCBbXSwgKHt2YWx1ZXN9KSA9PiB7XG4gICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgIHRoaXMucXVldWUucHVzaCh7XG4gICAgICAgICAgdG9rZW46IGFjY291bnQudG9rZW4sXG4gICAgICAgICAgdHlwZTogdHlwZSxcbiAgICAgICAgICB0YWJsZTogdGFibGUsXG4gICAgICAgICAgaWQ6IHZhbHVlcy5yZXNvdXJjZV9pZFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGRvd25sb2FkV2l0aFJldHJpZXModXJsLCBvdXRwdXRGaWxlTmFtZSkge1xuICAgIC8vIGF3YWl0IEFQSUNsaWVudC5kb3dubG9hZCh1cmwsIG91dHB1dEZpbGVOYW1lKTtcbiAgICBhd2FpdCB0aGlzLmRvd25sb2FkKHVybCwgb3V0cHV0RmlsZU5hbWUpO1xuICAgIHJldHVybiBvdXRwdXRGaWxlTmFtZTtcblxuICAgIGxldCB0cmllcyA9IDA7XG4gICAgY29uc3QgbWF4VHJpZXMgPSA1O1xuXG4gICAgd2hpbGUgKCsrdHJpZXMgPCBtYXhUcmllcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kb3dubG9hZCh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICByZXR1cm4gb3V0cHV0RmlsZU5hbWU7XG4gICAgICB9IGNhdGNoIChleCkge1xuICAgICAgICBpZiAoZXgubWVzc2FnZSA9PT0gJ25vdCBmb3VuZCcpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCcucmVkLCB1cmwsIGV4Lm1lc3NhZ2UsICdyZXRyeWluZy4uLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGRvd25sb2FkKHVybCwgdG8pIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcnEgPSByZXF1ZXN0KHVybCkucGlwZShmcy5jcmVhdGVXcml0ZVN0cmVhbSh0bykpO1xuXG4gICAgICBycS5vbigncmVzcG9uc2UnLCBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlICE9PSAyMDApIHtcbiAgICAgICAgICAgICAgdGhpcy5hYm9ydCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIC5vbignYWJvcnQnLCAoKSA9PiByZWplY3QobmV3IEVycm9yKCdub3QgZm91bmQnKSkpXG4gICAgICAgIC5vbignY2xvc2UnLCAoKSA9PiByZXNvbHZlKHJxKSlcbiAgICAgICAgLm9uKCdlcnJvcicsIHJlamVjdCk7XG4gICAgICAvLyBycS5vbignY2xvc2UnLCAoKSA9PiByZXNvbHZlKHJxKSk7XG4gICAgICAvLyBycS5vbignZXJyb3InLCByZWplY3QpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJxID1cbiAgICAgICAgcmVxdWVzdCh1cmwpXG4gICAgICAgICAgLm9uKCdyZXNwb25zZScsIGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgIT09IDIwMCkge1xuICAgICAgICAgICAgICB0aGlzLmFib3J0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2Fib3J0JywgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignbm90IGZvdW5kJykpKVxuICAgICAgICAgIC5vbignY2xvc2UnLCAoKSA9PiByZXNvbHZlKHJxKSlcbiAgICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICAgIC5waXBlKGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHRvKSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==