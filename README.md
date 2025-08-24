# Backup to S3

A configurable Node.js package for backing up directories and databases to S3-compatible storage services.

## Features

- **Directory Backup**: Archive and compress directories with exclude patterns
- **Database Backup**: Support for MySQL, PostgreSQL, and MongoDB
- **S3-Compatible Upload**: Secure upload to any S3-compatible storage service with encryption
- **Retention Management**: Automatic cleanup of old backups
- **CLI Interface**: Easy-to-use command line interface
- **Configuration Validation**: JSON schema validation for config files

## Installation

```bash
npm install
```

## Configuration

Create a configuration file (e.g., `backup-config.json`) based on the example:

```json
{
  "s3": {
    "region": "us-east-1",
    "bucket": "my-backup-bucket",
    "accessKeyId": "YOUR_ACCESS_KEY_ID",
    "secretAccessKey": "YOUR_SECRET_ACCESS_KEY",
    "endpoint": "https://s3.amazonaws.com",
    "forcePathStyle": false
  },
  "directories": [
    {
      "name": "web-assets",
      "path": "/var/www/html",
      "exclude": ["node_modules", "*.log", "tmp/*"]
    }
  ],
  "databases": [
    {
      "name": "mysql-db",
      "type": "mysql",
      "host": "localhost",
      "port": 3306,
      "username": "backup_user",
      "password": "backup_password",
      "database": "my_database"
    }
  ],
  "backup": {
    "retention": {
      "daily": 7,
      "weekly": 4,
      "monthly": 12
    },
    "compression": true,
    "timestamp": true
  }
}
```

## Usage

### CLI Commands

```bash
# Run backup
npx backup-to-s3 backup -c backup-config.json

# Validate configuration
npx backup-to-s3 validate -c backup-config.json

# List existing backups
npx backup-to-s3 list -c backup-config.json

# Verbose output
npx backup-to-s3 backup -c backup-config.json -v

# Quiet mode (errors only)
npx backup-to-s3 backup -c backup-config.json -q
```

### Programmatic Usage

```javascript
const BackupManager = require('./src/index');

const backupManager = new BackupManager('./backup-config.json');

backupManager.runBackup()
  .then(result => {
    console.log('Backup completed:', result);
  })
  .catch(error => {
    console.error('Backup failed:', error);
  });
```

## Database Requirements

### MySQL
- `mysqldump` command must be available
- User must have appropriate permissions for database access

### PostgreSQL
- `pg_dump` command must be available
- User must have appropriate permissions for database access

### MongoDB
- `mongodump` command must be available
- Connection string should include authentication if required

## S3-Compatible Storage Support

This tool supports various S3-compatible storage services:

- **Amazon S3** (default)
- **DigitalOcean Spaces** 
- **Wasabi Cloud Storage**
- **Backblaze B2**
- **Cloudflare R2**
- **MinIO** (self-hosted)
- Any other S3-compatible service

### Configuration Examples

See `s3-compatible-examples.json` for complete configuration examples for different providers.

**For non-AWS services**, add these fields to your S3 configuration:
- `endpoint`: The service's S3 API endpoint URL
- `forcePathStyle`: Set to `true` for path-style URLs (required for MinIO)

## Storage Permissions

The storage user/key needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-backup-bucket/*",
        "arn:aws:s3:::your-backup-bucket"
      ]
    }
  ]
}
```

## Directory Structure

```
backup-to-s3/
├── src/
│   ├── index.js           # Main BackupManager class
│   ├── cli.js             # Command line interface
│   ├── config.js          # Configuration validation
│   ├── directory-backup.js # Directory backup functionality
│   ├── database-backup.js  # Database backup functionality
│   ├── s3-uploader.js     # S3 upload and management
│   └── logger.js          # Logging utility
├── backup-config.example.json
├── package.json
└── README.md
```

## License

ISC