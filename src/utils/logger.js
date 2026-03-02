function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createLogger({ debug = false, scope = 'app' } = {}) {
  function emit(level, message, meta = null) {
    if (level === 'debug' && !debug) return;

    const payload = {
      ts: nowIso(),
      level,
      scope,
      message,
    };

    if (meta && Object.keys(meta).length > 0) {
      payload.meta = meta;
    }

    const serialized = JSON.stringify(payload);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  return {
    child(childScope, childMeta = null) {
      const mergedScope = `${scope}:${childScope}`;
      const parent = createLogger({ debug, scope: mergedScope });
      if (!childMeta) return parent;

      return {
        ...parent,
        debug: (message, meta = null) => parent.debug(message, { ...childMeta, ...meta }),
        info: (message, meta = null) => parent.info(message, { ...childMeta, ...meta }),
        warn: (message, meta = null) => parent.warn(message, { ...childMeta, ...meta }),
        error: (message, meta = null) => parent.error(message, { ...childMeta, ...meta }),
      };
    },
    debug(message, meta = null) {
      emit('debug', message, meta);
    },
    info(message, meta = null) {
      emit('info', message, meta);
    },
    warn(message, meta = null) {
      emit('warn', message, meta);
    },
    error(message, meta = null) {
      emit('error', message, meta);
    },
    product(level, product, message, meta = null) {
      const productMeta = {
        product_id: product?.id,
        product_name: product?.name,
        url: product?.url,
        ...meta,
      };
      emit(level, message, productMeta);
    },
    summary(title, summaryObject) {
      emit('info', title, summaryObject);
    },
    errorMessage(error) {
      return toErrorMessage(error);
    },
  };
}

export function errorToMessage(error) {
  return toErrorMessage(error);
}