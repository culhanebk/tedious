const fs = require('fs');
const { pipeline, Readable } = require('readable-stream');
const Connection = require('../../src/connection');
const Request = require('../../src/request');
const TYPES = require('../../src/data-type').typeByName;
const assert = require('chai').assert;

const debugMode = false;


function getConfig() {
  const { config } = JSON.parse(
    fs.readFileSync(require('os').homedir() + '/.tedious/test-connection.json', 'utf8')
  );

  config.options.tdsVersion = process.env.TEDIOUS_TDS_VERSION;

  if (debugMode) {
    config.options.debug = {
      packet: true,
      data: true,
      payload: true,
      token: true
    };
  }

  return config;
}

describe('Bulk Load Tests', function() {
  let connection;

  beforeEach(function(done) {
    connection = new Connection(getConfig());
    connection.connect(done);

    if (debugMode) {
      connection.on('debug', (message) => console.log(message));
      connection.on('infoMessage', (info) =>
        console.log('Info: ' + info.number + ' - ' + info.message)
      );
      connection.on('errorMessage', (error) =>
        console.log('Error: ' + error.number + ' - ' + error.message)
      );
    }
  });

  afterEach(function(done) {
    if (!connection.closed) {
      connection.on('end', done);
      connection.close();
    } else {
      done();
    }
  });

  it('should bulk load', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable', function(
      err,
      rowCount
    ) {
      if (err) {
        return done(err);
      }

      assert.strictEqual(rowCount, 5, 'Incorrect number of rows inserted.');

      done();
    });

    bulkLoad.addColumn('nnn', TYPES.Int, {
      nullable: false
    });
    bulkLoad.addColumn('sss', TYPES.NVarChar, {
      length: 50,
      nullable: true
    });
    bulkLoad.addColumn('ddd', TYPES.DateTime, {
      nullable: false
    });
    const request = new Request(bulkLoad.getTableCreationSql(), function(err) {
      if (err) {
        return done(err);
      }

      bulkLoad.addRow({
        nnn: 201,
        sss: 'one zero one',
        ddd: new Date(1986, 6, 20)
      });
      bulkLoad.addRow([202, 'one zero two', new Date()]);
      bulkLoad.addRow(203, 'one zero three', new Date(2013, 7, 12));
      bulkLoad.addRow({
        nnn: 204,
        sss: 'one zero four',
        ddd: new Date()
      });
      bulkLoad.addRow({
        nnn: 205,
        sss: 'one zero five',
        ddd: new Date()
      });
      connection.execBulkLoad(bulkLoad);
    });
    connection.execSqlBatch(request);
  });

  it('should bulkLoadError', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable2', function(
      err,
      rowCount
    ) {
      assert.ok(
        err,
        'An error should have been thrown to indicate the incorrect table format.'
      );

      done();
    });
    bulkLoad.addColumn('x', TYPES.Int, {
      nullable: false
    });
    bulkLoad.addColumn('y', TYPES.Int, {
      nullable: false
    });
    const request = new Request(
      'CREATE TABLE #tmpTestTable2 ([id] int not null)',
      function(err) {
        if (err) {
          return done(err);
        }

        bulkLoad.addRow({
          x: 1,
          y: 1
        });
        connection.execBulkLoad(bulkLoad);
      }
    );
    connection.execSqlBatch(request);
  });

  it('should bulkload verify constraints', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable3', { checkConstraints: true }, function(err, rowCount) {
      assert.ok(
        err,
        'An error should have been thrown to indicate the conflict with the CHECK constraint.'
      );
      done();
    });
    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });
    const request = new Request(`
    CREATE TABLE #tmpTestTable3 ([id] int,  CONSTRAINT chk_id CHECK (id BETWEEN 0 and 50 ))
  `, function(err) {
      if (err) {
        return done(err);
      }

      bulkLoad.addRow({
        id: 555
      });
      connection.execBulkLoad(bulkLoad);
    });
    connection.execSqlBatch(request);
  });

  it('should bulkload verify trigger', function(done) {
    const bulkLoad = connection.newBulkLoad('testTable4', { fireTriggers: true }, function(err, rowCount) {
      if (err) {
        return done(err);
      }

      connection.execSql(request_verify);
    });
    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });
    const createTable = 'CREATE TABLE testTable4 ([id] int);';
    const createTrigger = `
      CREATE TRIGGER bulkLoadTest on testTable4
      AFTER INSERT
      AS
      INSERT INTO testTable4 SELECT * FROM testTable4;
    `;
    const verifyTrigger = 'SELECT COUNT(*) FROM testTable4';
    const dropTable = 'DROP TABLE testTable4';

    const request_table = new Request(createTable, function(err) {
      if (err) {
        return done(err);
      }

      connection.execSql(request_trigger);
    });

    const request_trigger = new Request(createTrigger, function(err) {
      if (err) {
        return done(err);
      }

      bulkLoad.addRow({
        id: 555
      });
      connection.execBulkLoad(bulkLoad);
    });

    const request_verify = new Request(verifyTrigger, function(err) {
      if (err) {
        return done(err);
      }

      connection.execSql(request_dropTable);
    });

    const request_dropTable = new Request(dropTable, function(err) {
      if (err) {
        return done(err);
      }

      done();
    });

    request_verify.on('row', function(columns) {
      assert.deepEqual(columns[0].value, 2);
    });

    connection.execSql(request_table);
  });

  it('should bulkload verify null value', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable5', { keepNulls: true }, function(
      err,
      rowCount
    ) {
      if (err) {
        return done(err);
      }

      connection.execSqlBatch(request_verifyBulkLoad);
    });
    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });
    const request = new Request(`
      CREATE TABLE #tmpTestTable5 ([id] int NULL DEFAULT 253565)
    `, function(err) {
      if (err) {
        return done(err);
      }

      bulkLoad.addRow({
        id: null
      });
      connection.execBulkLoad(bulkLoad);
    });
    const request_verifyBulkLoad = new Request('SELECT [id] FROM #tmpTestTable5', function(err) {
      if (err) {
        return done(err);
      }

      done();
    });
    request_verifyBulkLoad.on('row', function(columns) {
      assert.deepEqual(columns[0].value, null);
    });
    connection.execSqlBatch(request);
  });

  it('should bulkload cancel after request send does nothing', function(done) {

    const bulkLoad = connection.newBulkLoad('#tmpTestTable5', { keepNulls: true }, function(err, rowCount) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Canceled.');

      connection.execSqlBatch(request_verifyBulkLoad);
    });

    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });

    const request = new Request('CREATE TABLE #tmpTestTable5 ([id] int NULL DEFAULT 253565)', function(err) {
      if (err) {
        return done(err);
      }
      bulkLoad.addRow({ id: 1234 });
      connection.execBulkLoad(bulkLoad);
      bulkLoad.cancel();
    });

    const request_verifyBulkLoad = new Request('SELECT [id] FROM #tmpTestTable5', function(err, rowCount) {
      if (err) {
        return done(err);
      }

      assert.strictEqual(rowCount, 0);

      done();
    });

    request_verifyBulkLoad.on('row', function(columns) {
      assert.deepEqual(columns[0].value, null);
    });

    connection.execSqlBatch(request);
  });

  it('should bulkload cancel after request completed', function(done) {

    const bulkLoad = connection.newBulkLoad('#tmpTestTable5', { keepNulls: true }, function(err, rowCount) {
      if (err) {
        return done(err);
      }

      bulkLoad.cancel();

      connection.execSqlBatch(request_verifyBulkLoad);
    });

    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });

    const request = new Request('CREATE TABLE #tmpTestTable5 ([id] int NULL DEFAULT 253565)', function(err) {
      if (err) {
        return done(err);
      }

      bulkLoad.addRow({ id: 1234 });
      connection.execBulkLoad(bulkLoad);
    });

    const request_verifyBulkLoad = new Request('SELECT [id] FROM #tmpTestTable5', function(err, rowCount) {
      if (err) {
        return done(err);
      }

      assert.strictEqual(rowCount, 1);

      done();
    });

    request_verifyBulkLoad.on('row', function(columns) {
      assert.strictEqual(columns[0].value, 1234);
    });

    connection.execSqlBatch(request);
  });

  it('should test stream bulk load', function(done) {
    const totalRows = 20;
    const tableName = '#streamingBulkLoadTest';

    connection.on('error', done);
    startCreateTable();

    function startCreateTable() {
      const sql = 'create table ' + tableName + ' (i int not null primary key)';
      const request = new Request(sql, completeCreateTable);
      connection.execSqlBatch(request);
    }

    function completeCreateTable(err) {
      if (err) {
        return done(err);
      }

      startBulkLoad();
    }

    function startBulkLoad() {
      const bulkLoad = connection.newBulkLoad(tableName, completeBulkLoad);
      bulkLoad.addColumn('i', TYPES.Int, { nullable: false });
      const rowStream = bulkLoad.getRowStream();

      connection.execBulkLoad(bulkLoad);

      const rowSource = Readable.from((async function*() {
        let rowCount = 0;
        while (rowCount < totalRows) {
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });

          yield [rowCount++];
        }
      })(), { objectMode: true });

      rowSource.pipe(rowStream);
    }

    function completeBulkLoad(err, rowCount) {
      if (err) {
        return done(err);
      }

      assert.equal(rowCount, totalRows);
      startVerifyTableContent();
    }

    function startVerifyTableContent() {
      const request = new Request(`
        select count(*)
        from ${tableName} a
        inner join ${tableName} b on a.i = b.i - 1
      `, completeVerifyTableContent);
      request.setTimeout(30000);
      request.on('row', (row) => {
        assert.equal(row[0].value, totalRows - 1);
      });
      connection.execSqlBatch(request);
    }

    function completeVerifyTableContent(err, rowCount) {
      if (err) {
        return done(err);
      }

      assert.equal(rowCount, 1);
      done();
    }
  });

  it('should test streaming bulk load with cancel', function(done) {
    const totalRows = 20;

    startCreateTable();

    function startCreateTable() {
      const sql = 'create table #stream_test (i int not null primary key)';
      const request = new Request(sql, completeCreateTable);
      connection.execSqlBatch(request);
    }

    function completeCreateTable(err) {
      if (err) {
        return done(err);
      }

      startBulkLoad();
    }

    function startBulkLoad() {
      const bulkLoad = connection.newBulkLoad('#stream_test', completeBulkLoad);
      bulkLoad.addColumn('i', TYPES.Int, { nullable: false });

      const rowStream = bulkLoad.getRowStream();
      connection.execBulkLoad(bulkLoad);

      let rowCount = 0;
      const rowSource = Readable.from((async function*() {
        while (rowCount < totalRows) {
          if (rowCount === 10) {
            bulkLoad.cancel();
          }

          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });

          yield [rowCount++];
        }
      })(), { objectMode: true });

      pipeline(rowSource, rowStream, function(err) {
        assert.ok(err);
        assert.strictEqual(err.message, 'Canceled.');
        assert.strictEqual(rowCount, 10);
      });
    }

    function completeBulkLoad(err, rowCount) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Canceled.');

      assert.isUndefined(rowCount);
      startVerifyTableContent();
    }

    function startVerifyTableContent() {
      const sql = `
        select count(*)
        from #stream_test a
        inner join #stream_test b on a.i = b.i - 1
      `;
      const request = new Request(sql, completeVerifyTableContent);
      request.on('row', (row) => {
        assert.equal(row[0].value, 0);
      });
      connection.execSqlBatch(request);
    }

    function completeVerifyTableContent(err, rowCount) {
      if (err) {
        return done(err);
      }

      assert.equal(rowCount, 1);

      done();
    }
  });

  it('should throw `RequestError: Canceled` after 10ms', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable5', { keepNulls: true }, function(err, rowCount) {
      assert.instanceOf(err, Error);
      assert.strictEqual(err.name, 'RequestError');
      assert.strictEqual(err.message, 'Timeout: Request failed to complete in 10ms');

      done();
    });

    bulkLoad.setTimeout(10);

    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });

    const request = new Request('CREATE TABLE #tmpTestTable5 ([id] int NULL DEFAULT 253565)', function(err) {
      if (err) {
        return done(err);
      }

      for (let i = 0; i < 100000; i++) {
        bulkLoad.addRow({ id: 1234 });
      }

      connection.execBulkLoad(bulkLoad);
    });

    connection.execSqlBatch(request);
  });

  it('should throw `RequestError: Connection closed before request completed` after 2000ms', function(done) {
    const bulkLoad = connection.newBulkLoad('#tmpTestTable5', { keepNulls: true }, function(err, rowCount) {
      assert.instanceOf(err, Error);
      assert.strictEqual(err.name, 'RequestError');
      assert.strictEqual(err.message, 'Timeout: Request failed to complete in 2000ms');

      done();
    });

    bulkLoad.setTimeout(2000);

    bulkLoad.addColumn('id', TYPES.Int, {
      nullable: true
    });

    const request = new Request('CREATE TABLE #tmpTestTable5 ([id] int NULL DEFAULT 253565)', function(err) {
      if (err) {
        return done(err);
      }

      for (let i = 0; i < 900000; i++) {
        bulkLoad.addRow({ id: 1234 });
      }

      connection.execBulkLoad(bulkLoad);
    });

    connection.execSqlBatch(request);
  });

  it('should correctly time out on streaming bulk loads', function(done) {
    startCreateTable();

    function startCreateTable() {
      const sql = 'create table #stream_test (i int not null primary key)';
      const request = new Request(sql, completeCreateTable);
      connection.execSqlBatch(request);
    }

    function completeCreateTable(err) {
      if (err) {
        return done(err);
      }

      startBulkLoad();
    }

    function startBulkLoad() {
      const bulkLoad = connection.newBulkLoad('#stream_test', completeBulkLoad);
      bulkLoad.setTimeout(200);

      bulkLoad.addColumn('i', TYPES.Int, { nullable: false });

      const rowStream = bulkLoad.getRowStream();

      connection.execBulkLoad(bulkLoad);

      const rowSource = Readable.from((async function*() {
        yield [1];

        await new Promise((resolve) => {
          setTimeout(resolve, 500);
        });

        yield [2];
      })(), { objectMode: true });

      pipeline(rowSource, rowStream, function(err) {
        assert.ok(err);
        assert.strictEqual(err.message, 'Canceled.');
      });
    }

    function completeBulkLoad(err, rowCount) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Timeout: Request failed to complete in 200ms');

      assert.isUndefined(rowCount);
      done();
    }
  });
});

describe('Bulk Loads when `config.options.validateBulkLoadParameters` is `true`', () => {
  let connection;

  beforeEach(function(done) {
    const config = getConfig();
    config.options = { ...config.options, validateBulkLoadParameters: true };
    connection = new Connection(config);
    connection.connect(done);

    if (debugMode) {
      connection.on('debug', (message) => console.log(message));
      connection.on('infoMessage', (info) =>
        console.log('Info: ' + info.number + ' - ' + info.message)
      );
      connection.on('errorMessage', (error) =>
        console.log('Error: ' + error.number + ' - ' + error.message)
      );
    }
  });

  beforeEach(function(done) {
    const request = new Request('create table #stream_test ([value] date)', (err) => {
      done(err);
    });

    connection.execSqlBatch(request);
  });

  afterEach(function(done) {
    if (!connection.closed) {
      connection.on('end', done);
      connection.close();
    } else {
      done();
    }
  });

  it('should handle validation errors during streaming bulk loads', (done) => {
    const bulkLoad = connection.newBulkLoad('#stream_test', completeBulkLoad);
    bulkLoad.addColumn('value', TYPES.Date, { nullable: false });

    const rowStream = bulkLoad.getRowStream();
    connection.execBulkLoad(bulkLoad);

    const rowSource = Readable.from([
      ['invalid date']
    ]);

    pipeline(rowSource, rowStream, function(err) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Invalid date.');
    });

    function completeBulkLoad(err, rowCount) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Invalid date.');

      done();
    }
  });

  it('should allow reusing the connection after validation errors during streaming bulk loads', (done) => {
    const bulkLoad = connection.newBulkLoad('#stream_test', completeBulkLoad);
    bulkLoad.addColumn('value', TYPES.Date, { nullable: false });

    const rowStream = bulkLoad.getRowStream();
    connection.execBulkLoad(bulkLoad);

    const rowSource = Readable.from([ ['invalid date'] ]);

    pipeline(rowSource, rowStream, function(err) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Invalid date.');
    });

    function completeBulkLoad(err, rowCount) {
      assert.ok(err);
      assert.strictEqual(err.message, 'Invalid date.');

      const rows = [];
      const request = new Request('SELECT 1', (err) => {
        assert.ifError(err);

        assert.deepEqual([1], rows);

        done();
      });

      request.on('row', (row) => {
        rows.push(row[0].value);
      });

      connection.execSql(request);
    }
  });
});
