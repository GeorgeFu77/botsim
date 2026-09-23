// Tiny timestamped logger. No dependencies.

const COLORS = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', ok: '\x1b[32m', dim: '\x1b[90m' };
const RESET = '\x1b[0m';

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function emit(level, tag, args) {
  const color = COLORS[level] || '';
  const head = `${COLORS.dim}${stamp()}${RESET} ${color}[${tag}]${RESET}`;
  // eslint-disable-next-line no-console
  console.log(head, ...args);
}

export function makeLogger(tag) {
  return {
    info: (...a) => emit('info', tag, a),
    warn: (...a) => emit('warn', tag, a),
    error: (...a) => emit('error', tag, a),
    ok: (...a) => emit('ok', tag, a),
  };
}

export default makeLogger;
