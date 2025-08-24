const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class AuditLogger {
  constructor(options = {}) {
    this.logFile = options.logFile || path.join(process.cwd(), 'backup-audit.log');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.sessionId = crypto.randomBytes(8).toString('hex');
    
    // Ensure audit log directory exists with proper permissions
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { mode: 0o750, recursive: true });
    }
    
    // Set restrictive permissions on log file
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', { mode: 0o640 });
    }
  }

  /**
   * Log security-relevant events for audit trail
   */
  logEvent(eventType, details = {}) {
    const timestamp = new Date().toISOString();
    const eventId = crypto.randomBytes(4).toString('hex');
    
    const auditEvent = {
      timestamp,
      sessionId: this.sessionId,
      eventId,
      eventType,
      process: {
        pid: process.pid,
        ppid: process.ppid,
        user: process.getuid ? process.getuid() : 'unknown',
        cwd: process.cwd()
      },
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch()
      },
      details: this.sanitizeDetails(details)
    };

    const logEntry = JSON.stringify(auditEvent) + '\n';
    
    try {
      // Rotate log if needed
      this.rotateLogIfNeeded();
      
      // Append to log file
      fs.appendFileSync(this.logFile, logEntry, { mode: 0o640 });
    } catch (error) {
      // Fallback to stderr if audit log fails
      console.error(`Audit logging failed: ${error.message}`);
      console.error(`Audit event: ${logEntry}`);
    }
  }

  /**
   * Remove sensitive information from audit details
   */
  sanitizeDetails(details) {
    if (!details || typeof details !== 'object') {
      return details;
    }

    const sanitized = { ...details };
    
    // Remove or mask sensitive fields
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'credential',
      'accessKeyId', 'secretAccessKey', 'connectionString'
    ];
    
    const maskSensitiveValue = (obj, path = '') => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }
      
      const result = Array.isArray(obj) ? [] : {};
      
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        
        if (sensitiveFields.some(field => 
          key.toLowerCase().includes(field.toLowerCase()) ||
          fullPath.toLowerCase().includes(field.toLowerCase())
        )) {
          result[key] = value ? '[REDACTED]' : value;
        } else if (typeof value === 'object' && value !== null) {
          result[key] = maskSensitiveValue(value, fullPath);
        } else {
          result[key] = value;
        }
      }
      
      return result;
    };

    return maskSensitiveValue(sanitized);
  }

  /**
   * Rotate log files when they get too large
   */
  rotateLogIfNeeded() {
    try {
      const stats = fs.statSync(this.logFile);
      if (stats.size > this.maxFileSize) {
        this.rotateLogFiles();
      }
    } catch (error) {
      // File doesn't exist yet, no rotation needed
    }
  }

  rotateLogFiles() {
    const logDir = path.dirname(this.logFile);
    const logBasename = path.basename(this.logFile, path.extname(this.logFile));
    const logExtension = path.extname(this.logFile);

    // Shift existing log files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(logDir, `${logBasename}.${i}${logExtension}`);
      const newFile = path.join(logDir, `${logBasename}.${i + 1}${logExtension}`);
      
      if (fs.existsSync(oldFile)) {
        if (i === this.maxFiles - 1) {
          // Remove oldest file
          fs.unlinkSync(oldFile);
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }

    // Move current log to .1
    const rotatedFile = path.join(logDir, `${logBasename}.1${logExtension}`);
    fs.renameSync(this.logFile, rotatedFile);
    
    // Create new log file
    fs.writeFileSync(this.logFile, '', { mode: 0o640 });
  }

  // Predefined audit event types for backup operations

  logBackupStart(config) {
    this.logEvent('BACKUP_START', {
      configPath: config.configPath,
      s3Bucket: config.s3?.bucket,
      s3Region: config.s3?.region,
      directoryCount: config.directories?.length || 0,
      databaseCount: config.databases?.length || 0
    });
  }

  logBackupComplete(result) {
    this.logEvent('BACKUP_COMPLETE', {
      backupCount: result.backups,
      totalSize: result.totalSize,
      uploadCount: result.uploads?.length || 0,
      duration: result.duration
    });
  }

  logBackupError(error, context = {}) {
    this.logEvent('BACKUP_ERROR', {
      errorMessage: error.message,
      errorType: error.constructor.name,
      context
    });
  }

  logCredentialAccess(source, type) {
    this.logEvent('CREDENTIAL_ACCESS', {
      source, // 'config_file', 'environment', 'mysql_config'
      type   // 's3', 'mysql', 'postgresql', 'mongodb'
    });
  }

  logFileAccess(filePath, operation) {
    this.logEvent('FILE_ACCESS', {
      filePath: path.normalize(filePath),
      operation, // 'read', 'write', 'delete'
      exists: fs.existsSync(filePath)
    });
  }

  logConfigValidation(configPath, valid, errors = []) {
    this.logEvent('CONFIG_VALIDATION', {
      configPath: path.normalize(configPath),
      valid,
      errorCount: errors.length,
      errors: errors.slice(0, 5) // Limit error details
    });
  }

  logDatabaseBackup(dbConfig, success, size = 0) {
    this.logEvent('DATABASE_BACKUP', {
      name: dbConfig.name,
      type: dbConfig.type,
      host: dbConfig.host,
      database: dbConfig.database,
      success,
      size
    });
  }

  logDirectoryBackup(dirConfig, success, size = 0) {
    this.logEvent('DIRECTORY_BACKUP', {
      name: dirConfig.name,
      path: path.normalize(dirConfig.path),
      excludeCount: dirConfig.exclude?.length || 0,
      success,
      size
    });
  }

  logS3Upload(fileName, s3Key, success, size = 0) {
    this.logEvent('S3_UPLOAD', {
      fileName,
      s3Key,
      success,
      size
    });
  }

  logRetentionCleanup(deletedCount, errors = []) {
    this.logEvent('RETENTION_CLEANUP', {
      deletedCount,
      errorCount: errors.length
    });
  }

  logSecurityEvent(eventType, details = {}) {
    this.logEvent('SECURITY_EVENT', {
      securityEventType: eventType,
      ...details
    });
  }
}

module.exports = AuditLogger;