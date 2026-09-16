// roq_guard.js — Layer 1 of scripts/roq.sh, ported from python to node.
//
// Why node: an Xcode CLT update on 2026-09-15 made /usr/bin/python3 refuse to
// run until the license was accepted, which took the read-only query path down
// mid-incident. There is no other python on this machine; node is
// /usr/local/bin/node and unaffected. The LOGIC is unchanged.
//
// This is NOT the security boundary — SET TRANSACTION READ ONLY in roq.sh is,
// and it is enforced by Postgres. This exists to fail fast with a readable
// message. Keep the two in sync if either changes.
//
// Reads SQL on stdin. Prints "OK", or "REFUSED: <reason>". Never exits non-zero
// on a refusal; roq.sh reads the text.

let sql = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { sql += d; });
process.stdin.on('end', () => {
  let s = sql;

  // Strip, in order: block comments, line comments, dollar-quoted bodies,
  // single-quoted literals, double-quoted identifiers. Everything that could
  // legitimately CONTAIN a semicolon or a scary keyword is removed first, so
  // the checks below only ever look at real SQL tokens.
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');
  s = s.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' {} ');
  s = s.replace(/'(?:[^']|'')*'/g, ' {} ');
  s = s.replace(/"(?:[^"]|"")*"/g, ' ident ');

  s = s.trim().replace(/;+\s*$/, '').trim();

  const fail = m => { console.log('REFUSED: ' + m); process.exit(0); };

  if (!s) fail('empty statement');
  if (s.includes(';')) fail('multiple statements are not allowed (found a ; between statements)');
  if (!/^(select|with|table|values|explain|show)\b/i.test(s)) {
    fail('must begin with SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW');
  }

  // Write keywords anywhere in the statement. Catches data-modifying CTEs,
  // which is the case a "starts with SELECT" check misses entirely.
  const WRITE = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|reindex|refresh|cluster|lock|comment|set|reset|begin|start|commit|rollback|savepoint|prepare|deallocate|discard|listen|notify|unlisten|import|security)\b/i;
  let m = s.match(WRITE);
  if (m) fail('statement contains a write/session keyword: ' + m[0].toUpperCase());

  // Functions that read the filesystem, execute programs, or disrupt the
  // server. A read-only transaction stops the writes but not all of these.
  const DANGER = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|pg_sleep|pg_reload_conf|set_config|pg_logical_emit_message)\b/i;
  m = s.match(DANGER);
  if (m) fail('statement calls a restricted function: ' + m[0]);

  console.log('OK');
});
