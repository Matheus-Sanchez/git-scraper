function compactErrorDetail(error) {
  const raw = error instanceof Error ? error.message : String(error || 'unexpected error');
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400) || 'unexpected error';
}

function withMetadata(errorCode, errorDetail, metadata = {}) {
  const filtered = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => (
      value !== undefined
      && value !== null
      && value !== ''
    )),
  );

  return {
    error: errorDetail,
    error_code: errorCode,
    error_detail: errorDetail,
    ...filtered,
  };
}

export function classifyAxiosFailure(error, metadata = {}) {
  const message = compactErrorDetail(error);
  const status = Number(error?.response?.status);
  const responseData = typeof error?.response?.data === 'string' ? error.response.data : '';
  const responseUrl = error?.response?.request?.res?.responseUrl || metadata.final_url || null;
  const contentType = error?.response?.headers?.['content-type'] || metadata.content_type || null;

  if (status === 403) {
    return withMetadata('http_403', message, { ...metadata, http_status: status, final_url: responseUrl, content_type: contentType });
  }
  if (status === 429) {
    return withMetadata('http_429', message, { ...metadata, http_status: status, final_url: responseUrl, content_type: contentType });
  }
  if (status >= 400) {
    return withMetadata('http_error', message, {
      ...metadata,
      http_status: status,
      final_url: responseUrl,
      content_type: contentType,
      html_size: responseData.length || metadata.html_size,
    });
  }
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(message)) {
    return withMetadata('timeout', message, metadata);
  }
  if (/redirect/i.test(message)) {
    return withMetadata('redirect_loop', message, metadata);
  }

  return withMetadata('unexpected_error', message, metadata);
}

export function classifyPlaywrightFailure(error, { stage = 'runtime', metadata = {} } = {}) {
  const message = compactErrorDetail(error);

  if (/browserType\.launchPersistentContext/i.test(message)) {
    return withMetadata('persistent_context_launch_failed', message, metadata);
  }
  if (/browserType\.launch/i.test(message)) {
    return withMetadata('browser_launch_failed', message, metadata);
  }
  if ((stage === 'navigation' || stage === 'goto') && /timeout/i.test(message)) {
    return withMetadata('navigation_timeout', message, metadata);
  }
  if (/ERR_TOO_MANY_REDIRECTS|redirect/i.test(message)) {
    return withMetadata('redirect_loop', message, metadata);
  }
  if (/captcha|robot check|digite os caracteres/i.test(message)) {
    return withMetadata('captcha_or_block', message, metadata);
  }
  if (/timeout/i.test(message)) {
    return withMetadata('timeout', message, metadata);
  }

  return withMetadata('unexpected_error', message, metadata);
}

export function classifyExtractionFailure(extraction, metadata = {}) {
  const errorCode = extraction?.error_code || 'price_not_found';
  const errorDetail = extraction?.reason || extraction?.error_detail || errorCode;

  return withMetadata(errorCode, errorDetail, {
    ...metadata,
    candidates_checked: extraction?.candidates_checked,
    top_candidates: Array.isArray(extraction?.top_candidates)
      ? extraction.top_candidates.slice(0, 5)
      : undefined,
  });
}

export function mergeFailureMetadata(baseFailure, metadata = {}) {
  return {
    ...baseFailure,
    ...Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => (
        value !== undefined
        && value !== null
        && value !== ''
      )),
    ),
  };
}

export function isRetryableFailure(failure) {
  if (!failure) return false;

  if (failure.error_code === 'timeout' || failure.error_code === 'http_429') {
    return true;
  }

  if (failure.error_code === 'http_error') {
    const status = Number(failure.http_status);
    return status >= 500;
  }

  return false;
}

export function buildFatalFailure({ phase, errorCode = 'unexpected_error', message, metadata = {} }) {
  return withMetadata(errorCode, compactErrorDetail(message), {
    engine: 'pipeline',
    phase,
    ...metadata,
  });
}
