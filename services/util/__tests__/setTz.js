// Force a non-Chicago host timezone for the whole run. The counter must
// derive Chicago wall-clock time explicitly; if any code path leaks through to
// the host clock, UTC makes that fail loudly instead of passing on a CT laptop.
module.exports = () => {
  process.env.TZ = 'UTC';
};
