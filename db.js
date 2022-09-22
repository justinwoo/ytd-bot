const sqlite3 = require("sqlite3");

const db = new sqlite3.Database("./db");

db.run(
  "create table if not exists jobs (url text, chat_id int, message_id int, sender int)"
);
db.run("create table if not exists downloads (url text, filename text)");

async function select(query, params) {
  return new Promise((res, rej) => {
    db.all(query, params, (err, xs) => {
      if (err) rej(err);
      res(xs);
    });
  });
}

async function run(query, params) {
  return new Promise((res, rej) => {
    db.run(query, params, (err, xs) => {
      if (err) rej(err);
      res(xs);
    });
  });
}

exports.getJobs = async () => {
  return select("select * from jobs", []);
};

exports.mkJob = async (url, chat_id, message_id, sender) => {
  return run(
    "insert into jobs (url, chat_id, message_id, sender) values (?,?,?,?)",
    [url, chat_id, message_id, sender]
  );
};

exports.rmJob = async (url) => {
  return run("delete from jobs where url = ?", [url]);
};

exports.mkDownload = async (url, filename) => {
  return run("insert into downloads (url, filename) values (?,?)", [
    url,
    filename,
  ]);
};

exports.getDownload = async (url) => {
  return select("select * from downloads where url = ?", [url]);
};

exports.rmDownload = async (url) => {
  return run("delete from downloads where url = ?", [url]);
};

exports.tests = async () => {
  await exports.mkJob("testjob");
  console.log(await exports.getJobs());
  await exports.rmJob("testjob");
  console.log(await exports.getJobs());

  await exports.mkDownload("testurl", "testpath");
  console.log(await exports.getDownload("testurl"));
  await exports.rmDownload("testurl");
  console.log(await exports.getDownload("testurl"));
};

exports.db = db;
