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
    });
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJhY2NvdW50IiwiZnVsY3J1bSIsImZldGNoQWNjb3VudCIsImFyZ3MiLCJvcmciLCJjb25jdXJyZW5jeSIsIk1hdGgiLCJtaW4iLCJtYXgiLCJxdWV1ZSIsIndvcmtlciIsInF1ZXVlTWVkaWFEb3dubG9hZCIsImRyYWluIiwiY29uc29sZSIsImVycm9yIiwidGFzayIsInVybCIsInBob3RvIiwiZ2V0UGhvdG9VUkwiLCJ2aWRlbyIsImdldFZpZGVvVVJMIiwiYXVkaW8iLCJnZXRBdWRpb1VSTCIsInNpZ25hdHVyZSIsImdldFNpZ25hdHVyZVVSTCIsInR5cGUiLCJiaW5kIiwidG9rZW4iLCJleHRlbnNpb24iLCJvdXRwdXRGaWxlTmFtZSIsImpvaW4iLCJtZWRpYVBhdGgiLCJ0YWJsZSIsImlkIiwiZXhpc3RzU3luYyIsInN0YXRTeW5jIiwic2l6ZSIsImxvZyIsImdyZWVuIiwib3V0cHV0TmFtZSIsImRvd25sb2FkV2l0aFJldHJpZXMiLCJyZWQiLCJzeW5jIiwiZXgiLCJjbGkiLCJjb21tYW5kIiwiZGVzYyIsImJ1aWxkZXIiLCJyZXF1aXJlZCIsImhhbmRsZXIiLCJkaXIiLCJkZWFjdGl2YXRlIiwiZmluZEVhY2hCeVNRTCIsInZhbHVlcyIsInB1c2giLCJyZXNvdXJjZV9pZCIsInRyaWVzIiwibWF4VHJpZXMiLCJkb3dubG9hZCIsIm1lc3NhZ2UiLCJ0byIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwicnEiLCJwaXBlIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJvbiIsInJlc3BvbnNlIiwic3RhdHVzQ29kZSIsImFib3J0IiwiRXJyb3IiXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7Ozs7Ozs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0F3Qm5CQSxVQXhCbUIscUJB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LFdBQVYsQ0FBUCxDQUxyQixFQU1HSixFQU5ILENBTU0sT0FOTixFQU1lLE1BQU1MLFFBQVFFLEVBQVIsQ0FOckIsRUFPR0csRUFQSCxDQU9NLE9BUE4sRUFPZUosTUFQZjtBQVFELEtBWE0sQ0FBUDtBQVlEO0FBM0lrQixDIiwiZmlsZSI6InBsdWdpbi5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IG1rZGlycCBmcm9tICdta2RpcnAnO1xuaW1wb3J0IENvbmN1cnJlbnRRdWV1ZSBmcm9tICcuL2NvbmN1cnJlbnQtcXVldWUnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCB7IEFQSUNsaWVudCB9IGZyb20gJ2Z1bGNydW0nO1xuaW1wb3J0IHJlcXVlc3QgZnJvbSAncmVxdWVzdCc7XG5pbXBvcnQgcmltcmFmIGZyb20gJ3JpbXJhZic7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIHtcbiAgYXN5bmMgdGFzayhjbGkpIHtcbiAgICByZXR1cm4gY2xpLmNvbW1hbmQoe1xuICAgICAgY29tbWFuZDogJ21lZGlhJyxcbiAgICAgIGRlc2M6ICdkb3dubG9hZCBtZWRpYScsXG4gICAgICBidWlsZGVyOiB7XG4gICAgICAgIG9yZzoge1xuICAgICAgICAgIGRlc2M6ICdvcmdhbml6YXRpb24gbmFtZScsXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgbWVkaWFQYXRoOiB7XG4gICAgICAgICAgZGVzYzogJ21lZGlhIHN0b3JhZ2UgZGlyZWN0b3J5JyxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBjb25jdXJyZW5jeToge1xuICAgICAgICAgIGRlc2M6ICdjb25jdXJyZW50IGRvd25sb2FkcyAoYmV0d2VlbiAxIGFuZCAxMCknLFxuICAgICAgICAgIHR5cGU6ICdudW1iZXInXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gTWF0aC5taW4oTWF0aC5tYXgoMSwgZnVsY3J1bS5hcmdzLmNvbmN1cnJlbmN5IHx8IDUpLCAxMCk7XG5cbiAgICAgIHRoaXMucXVldWUgPSBuZXcgQ29uY3VycmVudFF1ZXVlKHRoaXMud29ya2VyLCBjb25jdXJyZW5jeSk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdwaG90b3MnLCAncGhvdG8nKTtcbiAgICAgIGF3YWl0IHRoaXMucXVldWVNZWRpYURvd25sb2FkKGFjY291bnQsICdzaWduYXR1cmVzJywgJ3NpZ25hdHVyZScpO1xuICAgICAgYXdhaXQgdGhpcy5xdWV1ZU1lZGlhRG93bmxvYWQoYWNjb3VudCwgJ2F1ZGlvJywgJ2F1ZGlvJyk7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCAndmlkZW9zJywgJ3ZpZGVvJyk7XG5cbiAgICAgIGF3YWl0IHRoaXMucXVldWUuZHJhaW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIHRoaXMubWVkaWFQYXRoID0gZnVsY3J1bS5hcmdzLm1lZGlhUGF0aCB8fCBmdWxjcnVtLmRpcignbWVkaWEnKTtcblxuICAgIG1rZGlycC5zeW5jKHRoaXMubWVkaWFQYXRoKTtcbiAgICBta2RpcnAuc3luYyhwYXRoLmpvaW4odGhpcy5tZWRpYVBhdGgsICdwaG90b3MnKSk7XG4gICAgbWtkaXJwLnN5bmMocGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCAndmlkZW9zJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ2F1ZGlvJykpO1xuICAgIG1rZGlycC5zeW5jKHBhdGguam9pbih0aGlzLm1lZGlhUGF0aCwgJ3NpZ25hdHVyZXMnKSk7XG5cbiAgICAvLyBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIC8vIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICB9XG5cbiAgd29ya2VyID0gYXN5bmMgKHRhc2spID0+IHtcbiAgICBjb25zdCB1cmwgPSB7XG4gICAgICBwaG90bzogQVBJQ2xpZW50LmdldFBob3RvVVJMLFxuICAgICAgdmlkZW86IEFQSUNsaWVudC5nZXRWaWRlb1VSTCxcbiAgICAgIGF1ZGlvOiBBUElDbGllbnQuZ2V0QXVkaW9VUkwsXG4gICAgICBzaWduYXR1cmU6IEFQSUNsaWVudC5nZXRTaWduYXR1cmVVUkxcbiAgICB9W3Rhc2sudHlwZV0uYmluZChBUElDbGllbnQpKHt0b2tlbjogdGFzay50b2tlbn0sIHRhc2spO1xuXG4gICAgY29uc3QgZXh0ZW5zaW9uID0ge1xuICAgICAgcGhvdG86ICdqcGcnLFxuICAgICAgdmlkZW86ICdtcDQnLFxuICAgICAgYXVkaW86ICdtNGEnLFxuICAgICAgc2lnbmF0dXJlOiAncG5nJ1xuICAgIH1bdGFzay50eXBlXTtcblxuICAgIGNvbnN0IG91dHB1dEZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMubWVkaWFQYXRoLCB0YXNrLnRhYmxlLCB0YXNrLmlkICsgJy4nICsgZXh0ZW5zaW9uKTtcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhvdXRwdXRGaWxlTmFtZSkgfHwgZnMuc3RhdFN5bmMob3V0cHV0RmlsZU5hbWUpLnNpemUgPT09IDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdEb3dubG9hZGluZycsIHRhc2sudHlwZS5ncmVlbiwgdGFzay5pZCk7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0TmFtZSA9IGF3YWl0IHRoaXMuZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKTtcblxuICAgICAgICBpZiAob3V0cHV0TmFtZSA9PSBudWxsKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ05vdCBGb3VuZCcucmVkLCB1cmwpO1xuICAgICAgICAgIHJpbXJhZi5zeW5jKG91dHB1dEZpbGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgY29uc29sZS5sb2coZXgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHF1ZXVlTWVkaWFEb3dubG9hZChhY2NvdW50LCB0YWJsZSwgdHlwZSkge1xuICAgIGF3YWl0IGFjY291bnQuZmluZEVhY2hCeVNRTChgU0VMRUNUIHJlc291cmNlX2lkIEZST00gJHsgdGFibGUgfSBXSEVSRSBpc19kb3dubG9hZGVkID0gMGAsIFtdLCAoe3ZhbHVlc30pID0+IHtcbiAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKHtcbiAgICAgICAgICB0b2tlbjogYWNjb3VudC50b2tlbixcbiAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgIHRhYmxlOiB0YWJsZSxcbiAgICAgICAgICBpZDogdmFsdWVzLnJlc291cmNlX2lkXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZG93bmxvYWRXaXRoUmV0cmllcyh1cmwsIG91dHB1dEZpbGVOYW1lKSB7XG4gICAgbGV0IHRyaWVzID0gMDtcbiAgICBjb25zdCBtYXhUcmllcyA9IDU7XG5cbiAgICB3aGlsZSAoKyt0cmllcyA8IG1heFRyaWVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmRvd25sb2FkKHVybCwgb3V0cHV0RmlsZU5hbWUpO1xuXG4gICAgICAgIHJldHVybiBvdXRwdXRGaWxlTmFtZTtcbiAgICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICAgIGlmIChleC5tZXNzYWdlID09PSAnbm90IGZvdW5kJykge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkJy5yZWQsIHVybCwgZXgubWVzc2FnZSwgJ3JldHJ5aW5nLi4uJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZG93bmxvYWQodXJsLCB0bykge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBycSA9IHJlcXVlc3QodXJsKS5waXBlKGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHRvKSk7XG5cbiAgICAgIHJxLm9uKCdyZXNwb25zZScsIGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgIT09IDIwMCkge1xuICAgICAgICAgICAgICB0aGlzLmFib3J0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgLm9uKCdhYm9ydCcsICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ25vdCBmb3VuZCcpKSlcbiAgICAgICAgLm9uKCdjbG9zZScsICgpID0+IHJlc29sdmUocnEpKVxuICAgICAgICAub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICB9KTtcbiAgfVxufVxuIl19