const htmlEntities = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  "'": '&#x27;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
};

const escapeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"'`=\/]/g, char => htmlEntities[char]);
};

const dangerousPatterns = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /data:/gi,
  /vbscript:/gi,
  /expression\s*\(/gi,
];

const sqlPatterns = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b)/gi,
  /(\b(UNION|JOIN|WHERE|FROM|INTO)\b.*\b(SELECT|INSERT|UPDATE|DELETE)\b)/gi,
  /(--|#|\/\*|\*\/)/g,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi,
  /'\s*(OR|AND)\s*'/gi,
];

const noSqlPatterns = [
  /\$where/gi, /\$regex/gi, /\$ne/gi, /\$gt/gi, /\$lt/gi,
  /\$or/gi, /\$and/gi, /\$exists/gi, /\$elemMatch/gi,
];

const sanitizeString = (str, options = {}) => {
  if (typeof str !== 'string') return str;
  let sanitized = str.trim();
  sanitized = sanitized.replace(/\0/g, '');
  if (options.escapeHtml !== false) sanitized = escapeHtml(sanitized);
  if (options.removeDangerous !== false) {
    dangerousPatterns.forEach(pattern => { sanitized = sanitized.replace(pattern, ''); });
  }
  return sanitized;
};

const sanitizeObject = (obj, options = {}) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj, options);
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item, options));
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      const sanitizedKey = sanitizeString(key, { escapeHtml: false });
      if (sanitizedKey !== '__proto__' && sanitizedKey !== 'constructor' && sanitizedKey !== 'prototype') {
        sanitized[sanitizedKey] = sanitizeObject(obj[key], options);
      }
    }
    return sanitized;
  }
  return obj;
};

const detectSqlInjection = (value) => {
  if (typeof value !== 'string') return false;
  return sqlPatterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
};

const detectNoSqlInjection = (value) => {
  if (typeof value !== 'string') return false;
  return noSqlPatterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
};

const sanitizeRequest = (options = {}) => {
  return (req, res, next) => {
    try {
      if (req.body) req.body = sanitizeObject(req.body, options);
      if (req.query) req.query = sanitizeObject(req.query, options);
      if (req.params) req.params = sanitizeObject(req.params, options);
      next();
    } catch (error) {
      console.error('Sanitization error:', error);
      next();
    }
  };
};

const blockInjection = (req, res, next) => {
  const checkValue = (value, path) => {
    if (typeof value === 'string') {
      if (detectSqlInjection(value)) {
        console.warn(`[SECURITY] SQL injection attempt in ${path}: ${value.substring(0, 100)}`);
        return { detected: true, type: 'SQL', path };
      }
      if (detectNoSqlInjection(value)) {
        console.warn(`[SECURITY] NoSQL injection attempt in ${path}: ${value.substring(0, 100)}`);
        return { detected: true, type: 'NoSQL', path };
      }
    }
    return { detected: false };
  };
  
  const checkObject = (obj, prefix = '') => {
    if (typeof obj === 'string') return checkValue(obj, prefix);
    if (typeof obj === 'object' && obj !== null) {
      for (const key of Object.keys(obj)) {
        const result = checkObject(obj[key], `${prefix}.${key}`);
        if (result.detected) return result;
      }
    }
    return { detected: false };
  };
  
  const sources = [
    { data: req.body, name: 'body' },
    { data: req.query, name: 'query' },
    { data: req.params, name: 'params' }
  ];
  
  for (const source of sources) {
    const result = checkObject(source.data, source.name);
    if (result.detected) {
      return res.status(400).json({ success: false, message: 'Invalid input detected', code: 'INJECTION_BLOCKED' });
    }
  }
  next();
};

const sanitizeMongoQuery = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$')) {
        console.warn(`[SECURITY] Blocked MongoDB operator in request: ${key}`);
        continue;
      }
      sanitized[key] = typeof obj[key] === 'object' ? sanitize(obj[key]) : obj[key];
    }
    return sanitized;
  };
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  next();
};

const sanitizeBookingData = (req, res, next) => {
  if (req.body) {
    if (req.body.address) {
      req.body.address = req.body.address.replace(/<[^>]*>/g, '').replace(/[^\w\s,.\-#]/g, '').trim();
    }
    if (req.body.description) {
      req.body.description = req.body.description.replace(/<[^>]*>/g, '').substring(0, 500);
    }
    if (req.body.notes) {
      req.body.notes = req.body.notes.replace(/<[^>]*>/g, '').substring(0, 1000);
    }
  }
  next();
};

module.exports = {
  sanitizeRequest,
  sanitizeString,
  sanitizeObject,
  blockInjection,
  sanitizeMongoQuery,
  sanitizeBookingData,
  detectSqlInjection,
  detectNoSqlInjection,
  escapeHtml
};
