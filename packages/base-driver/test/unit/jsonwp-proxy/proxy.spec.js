import {JWProxy} from '../../../lib';
import request from './mock-request';
import {isErrorType, errors} from '../../../lib/protocol/errors';
import {getTestPort, TEST_HOST} from '@appium/driver-test-support';

function buildReqRes(url, method, body) {
  let req = {originalUrl: url, method, body};
  let res = {};
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (code) => {
    res.sentCode = code;
    return res;
  };
  res.send = (body) => {
    try {
      body = JSON.parse(body);
    } catch {}
    res.sentBody = body;
  };
  return [req, res];
}

describe('proxy', function () {
  let port;
  let should;

  before(async function () {
    const chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');
    chai.use(chaiAsPromised.default);
    should = chai.should();
    port = await getTestPort();
  });

  function mockProxy(opts = {}) {
    // sets default server/port
    opts = {server: TEST_HOST, port, ...opts};
    let proxy = new JWProxy(opts);
    proxy.request = async function (...args) {
      return await request(...args);
    };
    return proxy;
  }

  it('should override default params', function () {
    let j = mockProxy({server: '127.0.0.2', port});
    j.server.should.equal('127.0.0.2');
    j.port.should.equal(port);
  });
  it('should save session id on session creation', async function () {
    let j = mockProxy();
    let [res, body] = await j.proxy('/session', 'POST', {
      desiredCapabilities: {},
    });
    res.statusCode.should.equal(200);
    body.should.eql({status: 0, sessionId: '123', value: {browserName: 'boo'}});
    j.sessionId.should.equal('123');
  });
  describe('getUrlForProxy', function () {
    it('should modify session id, host, and port', function () {
      mockProxy({sessionId: '123'})
        .getUrlForProxy('http://host.com:1234/session/456/element/200/value', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session/123/element/200/value`
        );
    });
    it('should prepend scheme, host and port if not provided', function () {
      let j = mockProxy({sessionId: '123'});
      j.getUrlForProxy('/session/456/element/200/value', 'POST').should.eql(
        `http://${TEST_HOST}:${port}/session/123/element/200/value`
      );
      j.getUrlForProxy('/session/456/appium/settings', 'POST').should.eql(
        `http://${TEST_HOST}:${port}/session/123/appium/settings`
      );
    });
    it('should prepend scheme, host, port and session if not provided', function () {
      mockProxy({sessionId: '123'})
        .getUrlForProxy('/element/200/value', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session/123/element/200/value`
        );
    });
    it('should keep query parameters', function () {
      mockProxy({sessionId: '123'})
        .getUrlForProxy('/element/200/value?foo=1&bar=2', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session/123/element/200/value?foo=1&bar=2`
        );
    });
    it('should fix legacy proxy urls if reqBasePath is unset', function () {
      const j = mockProxy({sessionId: '123', reqBasePath: ''});
      j.getUrlForProxy('/wd/hub/session/456/element/200/value', 'POST').should.eql(
        `http://${TEST_HOST}:${port}/session/123/element/200/value`
      );
      j.getUrlForProxy('/yolo/session/456/element/200/value', 'POST').should.eql(
        `http://${TEST_HOST}:${port}/session/123/element/200/value`
      );
    });
    it('should respect nonstandard incoming request base path', function () {
      mockProxy({sessionId: '123', reqBasePath: ''})
        .getUrlForProxy('/session/456/element/200/value', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session/123/element/200/value`
        );

      mockProxy({sessionId: '123', reqBasePath: '/my/base/path'})
        .getUrlForProxy('/my/base/path/session/456/element/200/value', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session/123/element/200/value`
        );

      mockProxy({sessionId: '123', reqBasePath: '/wd/hub'})
        .getUrlForProxy('/wd/hub/session/456', 'GET').should.eql(
          `http://${TEST_HOST}:${port}/session/123`
        );

      mockProxy({reqBasePath: '/my/base/path'})
        .getUrlForProxy('/my/base/path/session', 'POST').should.eql(
          `http://${TEST_HOST}:${port}/session`
        );
    });
    it('should work with urls which do not have session ids', function () {
      let j = mockProxy({sessionId: '123'});
      j.getUrlForProxy('http://host.com:1234/session', 'POST').should.eql(
        `http://${TEST_HOST}:${port}/session`
      );

      j.getUrlForProxy('/session', 'POST')
        .should.eql(`http://${TEST_HOST}:${port}/session`);
      j.getUrlForProxy('/appium/sessions', 'GET')
        .should.eql(`http://${TEST_HOST}:${port}/appium/sessions`);
    });
    it('should throw an error if url requires a sessionId but its null', function () {
      let j = mockProxy();
      let e;
      try {
        j.getUrlForProxy('/session/456/element/200/value', 'POST');
      } catch (err) {
        e = err;
      }
      should.exist(e);
      e.message.should.contain('not set');
    });
    it('should not throw an error if url does not require a session id and its null', function () {
      let newUrl = mockProxy().getUrlForProxy('/status', 'GET');
      should.exist(newUrl);
    });
  });
  describe('straight proxy', function () {
    it('should successfully proxy straight', async function () {
      let j = mockProxy();
      let [res, body] = await j.proxy('/status', 'GET');
      res.statusCode.should.equal(200);
      body.should.eql({status: 0, value: {foo: 'bar'}});
    });
    it('should pass along request errors', function () {
      let j = mockProxy({sessionId: '123'});
      j.proxy('/badurl', 'GET').should.eventually.be.rejectedWith('Could not proxy');
    });
    it('should proxy error responses and codes', async function () {
      let j = mockProxy({sessionId: '123'});
      try {
        await j.proxy('/element/bad/text', 'GET');
      } catch (e) {
        isErrorType(e.getActualError(), errors.ElementNotVisibleError).should.be.true;
      }
    });
  });
  describe('command proxy', function () {
    it('should successfully proxy command', async function () {
      let j = mockProxy();
      let res = await j.command('/status', 'GET');
      res.should.eql({foo: 'bar'});
    });
    it('should pass along request errors', function () {
      let j = mockProxy({sessionId: '123'});
      j.command('/badurl', 'GET').should.eventually.be.rejectedWith('Could not proxy');
    });
    it('should throw when a command fails', async function () {
      let j = mockProxy({sessionId: '123'});
      let e = null;
      try {
        await j.command('/element/bad/text', 'GET');
      } catch (err) {
        e = err;
      }
      should.exist(e);
      e.message.should.contain('Invisible element');
    });
    it('should throw when a command fails with a 200 because the status is not 0', async function () {
      let j = mockProxy({sessionId: '123'});
      let e = null;
      try {
        await j.command('/element/200/text', 'GET');
      } catch (err) {
        e = err;
      }
      should.exist(e);
      e.error.should.eql('element not visible');
    });
    it('should throw when a command fails with a 100', async function () {
      let j = mockProxy({sessionId: '123'});
      let e = null;
      try {
        await j.command('/session/badchrome/nochrome', 'GET');
      } catch (err) {
        e = err;
      }
      should.exist(e);
      e.message.should.contain('chrome not reachable');
    });
  });
  describe('req/res proxy', function () {
    it('should successfully proxy via req and send to res', async function () {
      let j = mockProxy();
      let [req, res] = buildReqRes('/status', 'GET');
      await j.proxyReqRes(req, res);
      res.headers['content-type'].should.equal('application/json; charset=utf-8');
      res.sentCode.should.equal(200);
      res.sentBody.should.eql({value: {foo: 'bar'}});
    });
    it('should rewrite the inner session id so it doesnt change', async function () {
      let j = mockProxy({sessionId: '123'});
      let [req, res] = buildReqRes('/element/200/value', 'GET');
      await j.proxyReqRes(req, res);
      res.sentBody.should.eql({value: 'foobar', sessionId: '123'});
    });
    it('should rewrite the inner session id with sessionId in url', async function () {
      let j = mockProxy({sessionId: '123'});
      let [req, res] = buildReqRes('/session/456/element/200/value', 'POST');
      await j.proxyReqRes(req, res);
      res.sentBody.should.eql({value: 'foobar', sessionId: '456'});
    });
    it('should pass through urls that do not require session IDs', async function () {
      let j = mockProxy({sessionId: '123'});
      let [req, res] = buildReqRes('/status', 'GET');
      await j.proxyReqRes(req, res);
      res.sentBody.should.eql({value: {foo: 'bar'}});
    });
    it('should proxy strange responses', async function () {
      let j = mockProxy({sessionId: '123'});
      let [req, res] = buildReqRes('/nochrome', 'GET');
      await j.proxyReqRes(req, res);
      res.sentCode.should.equal(100);
      res.sentBody.should.eql({value: {message: 'chrome not reachable'}});
    });
  });
});
