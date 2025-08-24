# Security Guide

This document outlines the security enhancements implemented in backup-to-s3 and provides guidance for secure deployment and operation.

## Security Enhancements

### 1. Credential Management

**Environment Variables (Recommended)**
- S3 credentials should be provided via environment variables instead of config files
- Database passwords can be provided via environment variables
- Supports per-database credential configuration

```bash
# S3 Credentials
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-east-1"
export S3_BUCKET="your-backup-bucket"

# Database Credentials (by index)
export DB_0_PASSWORD="mysql-password"
export DB_1_PASSWORD="postgres-password"

# Database Credentials (by name)
export DB_MYSQL_DB_PASSWORD="mysql-password"
export DB_POSTGRES_DB_PASSWORD="postgres-password"
```

**MySQL Config Files**
- MySQL backups now use config files instead of command-line passwords
- Temporary config files are created with 600 permissions
- Config files are automatically cleaned up after use

### 2. Input Validation and Sanitization

**Configuration Validation**
- Strict schema validation with Joi
- Pattern matching for all string inputs
- Length limits on all user inputs
- Hostname validation for database connections
- URI validation for endpoints

**Path Traversal Protection**
- All file paths are resolved and normalized
- Path traversal patterns (`../`) are blocked
- Symlinks outside directories are not followed

**Input Sanitization**
- Dangerous shell characters are stripped from inputs
- Exclusion patterns are sanitized before use
- Database connection parameters are validated

### 3. Secure Command Execution

**Replaced Shell Commands**
- Uses `spawn()` instead of `exec()` for better security
- Parameters are passed as arrays instead of concatenated strings
- No shell interpretation of user input

**Command Isolation**
- Each command runs in controlled environment
- Credentials passed via environment variables or config files
- Output streams are properly captured and controlled

### 4. File System Security

**Temporary File Permissions**
- All temporary files created with 600 permissions (owner read/write only)
- Temporary directories created with 700 permissions
- Secure random filenames prevent prediction

**File Permission Validation**
- Configuration files checked for overly permissive permissions
- Warnings issued for config files with permissions > 600
- Backup files created with restricted permissions

### 5. Audit Logging

**Comprehensive Audit Trail**
- All security-relevant events are logged
- Credential access sources are tracked
- File system operations are logged
- Failed operations and errors are recorded

**Log Security**
- Audit logs created with restricted permissions (640)
- Sensitive data is automatically redacted from logs
- Log rotation prevents unbounded growth
- Structured JSON format for analysis

### 6. Network Security

**S3 Configuration**
- Server-side encryption enabled (AES256) by default
- Support for custom S3-compatible endpoints
- Signature version validation
- Bucket name pattern validation

## Deployment Security

### 1. System Requirements

**Minimum Permissions**
- Run backup-to-s3 with a dedicated non-root user
- Grant minimal filesystem permissions
- Use systemd user services for automation

**Database User Privileges**
```sql
-- MySQL: Create dedicated backup user
CREATE USER 'backup_user'@'localhost' IDENTIFIED BY 'strong_password';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON database.* TO 'backup_user'@'localhost';
FLUSH PRIVILEGES;

-- PostgreSQL: Create dedicated backup user
CREATE USER backup_user WITH PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE your_database TO backup_user;
GRANT USAGE ON SCHEMA public TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_user;
```

### 2. Configuration Security

**File Permissions**
```bash
# Set secure permissions on config file
chmod 600 backup-config.json
chown backup_user:backup_user backup-config.json

# Ensure config directory is secure
chmod 750 /path/to/config/directory
```

**Environment Variables**
```bash
# Use systemd environment files
echo "AWS_ACCESS_KEY_ID=your-key" > /etc/backup-to-s3/environment
echo "AWS_SECRET_ACCESS_KEY=your-secret" >> /etc/backup-to-s3/environment
chmod 600 /etc/backup-to-s3/environment
```

### 3. S3 Bucket Security

**IAM Policy (Minimal Permissions)**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-backup-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::your-backup-bucket"
    }
  ]
}
```

**Bucket Policy**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnforceSSLRequestsOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::your-backup-bucket",
        "arn:aws:s3:::your-backup-bucket/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

### 4. Monitoring and Alerting

**Audit Log Monitoring**
```bash
# Monitor audit logs for security events
tail -f backup-audit.log | jq 'select(.eventType == "SECURITY_EVENT")'

# Alert on backup failures
grep "BACKUP_ERROR" backup-audit.log
```

**System Integration**
```bash
# Send audit logs to syslog
logger -t backup-to-s3 -f backup-audit.log

# Integration with monitoring systems
curl -X POST monitoring-system/api/logs -d @backup-audit.log
```

## Security Configuration Examples

### Minimal Security Configuration

```json
{
  "s3": {
    "region": "us-east-1",
    "bucket": "my-secure-backups"
  },
  "directories": [
    {
      "name": "app-data",
      "path": "/var/lib/myapp",
      "exclude": ["*.log", "tmp/*", "cache/*"]
    }
  ],
  "databases": [
    {
      "name": "main-db",
      "type": "mysql",
      "host": "localhost",
      "username": "backup_user",
      "database": "production",
      "configFile": "/etc/backup-to-s3/mysql.cnf"
    }
  ],
  "backup": {
    "retention": {
      "daily": 7,
      "weekly": 4,
      "monthly": 12
    },
    "tempDir": "/var/tmp/backup-to-s3",
    "filePermissions": "600"
  }
}
```

### MySQL Config File Example

```ini
# /etc/backup-to-s3/mysql.cnf (permissions: 600)
[client]
host=localhost
port=3306
user=backup_user
password=your_secure_password
```

## Security Monitoring

### Key Metrics to Monitor

1. **Failed Authentication Attempts**
   - Watch for repeated credential access failures
   - Monitor invalid configuration attempts

2. **Unusual File Access Patterns**
   - Unexpected path traversal attempts
   - Access to files outside configured directories

3. **Command Execution Anomalies**
   - Failed database command executions
   - Unusual process spawning patterns

4. **Network Security Events**
   - S3 upload failures due to permissions
   - Connection attempts to unauthorized endpoints

### Sample Monitoring Queries

```bash
# Failed backup attempts
grep '"eventType":"BACKUP_ERROR"' backup-audit.log | tail -10

# Credential access patterns
grep '"eventType":"CREDENTIAL_ACCESS"' backup-audit.log | \
  jq -r '[.timestamp, .details.source, .details.type] | @tsv'

# File system security events
grep '"eventType":"SECURITY_EVENT"' backup-audit.log | \
  jq -r '[.timestamp, .details.securityEventType] | @tsv'
```

## Incident Response

### Security Event Response

1. **Immediate Actions**
   - Stop backup processes if compromise is suspected
   - Rotate all credentials (S3, database)
   - Review audit logs for unauthorized access

2. **Investigation**
   - Analyze audit trail for attack patterns
   - Check system logs for related events
   - Verify integrity of backup files

3. **Recovery**
   - Update credentials in secure manner
   - Patch any identified vulnerabilities
   - Resume backups with enhanced monitoring

### Recovery Procedures

```bash
# Emergency credential rotation
aws iam create-access-key --user-name backup-user
aws iam delete-access-key --access-key-id OLD_KEY --user-name backup-user

# Audit log analysis
cat backup-audit.log | jq 'select(.timestamp > "2024-01-01")' | \
  grep -E "(SECURITY_EVENT|BACKUP_ERROR)"

# Verify backup integrity
aws s3 ls s3://your-bucket/ --recursive | tail -10
```

## Best Practices Summary

1. **Never store credentials in configuration files**
2. **Use dedicated database users with minimal privileges**
3. **Set restrictive file permissions on all backup-related files**
4. **Monitor audit logs regularly for security events**
5. **Rotate credentials regularly**
6. **Use encrypted storage for S3 backups**
7. **Implement network security controls**
8. **Test backup recovery procedures regularly**
9. **Keep backup software updated**
10. **Follow principle of least privilege**

---

For additional security guidance or to report security issues, please refer to the project's security policy.