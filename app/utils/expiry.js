function getAllowedDays() {
  const raw = process.env.ALLOWED_EXPIRY_DAYS || '2,4,7';
  return raw.split(',').map(Number).filter((n) => !isNaN(n) && n > 0);
}

function getDefaultDays() {
  return parseInt(process.env.DEFAULT_EXPIRY_DAYS, 10) || 2;
}

function daysToSeconds(days) {
  return days * 86400;
}

/**
 * Validate and return the expiry in seconds.
 * Falls back to default if the requested days are not in the allowed list.
 */
function validateExpiry(requestedDays) {
  const allowed = getAllowedDays();
  const days = allowed.includes(requestedDays) ? requestedDays : getDefaultDays();
  return {
    days,
    seconds: daysToSeconds(days),
    allowed,
  };
}

module.exports = { getAllowedDays, getDefaultDays, daysToSeconds, validateExpiry };
