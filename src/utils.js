/**
 * Utility functions for backup operations
 */

/**
 * Generate timestamp string for backup files
 * Format: YYYY-MM-DD_HH-MM-SS
 * @param {Date} date - Optional date object, defaults to now
 * @returns {string} Formatted timestamp string
 */
function generateTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Generate filename with timestamp
 * @param {string} baseName - Base name without extension
 * @param {string} extension - File extension (with dot)
 * @param {string} timestamp - Timestamp string
 * @returns {string} Filename with timestamp
 */
function generateTimestampedFilename(baseName, extension, timestamp) {
  return `${baseName}_${timestamp}${extension}`;
}

/**
 * Parse timestamp from filename
 * @param {string} filename - Filename with timestamp
 * @returns {Date|null} Parsed date or null if not found
 */
function parseTimestampFromFilename(filename) {
  // Match pattern: name_YYYY-MM-DD_HH-MM-SS.ext
  const timestampMatch = filename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (!timestampMatch) return null;
  
  const timestampStr = timestampMatch[1];
  const [datePart, timePart] = timestampStr.split('_');
  const [year, month, day] = datePart.split('-');
  const [hours, minutes, seconds] = timePart.split('-');
  
  return new Date(
    parseInt(year),
    parseInt(month) - 1, // Month is 0-indexed
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  );
}

module.exports = {
  generateTimestamp,
  generateTimestampedFilename,
  parseTimestampFromFilename
};