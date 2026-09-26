# FlipView Core Backend (Production)

Production-ready API, multi-tenant database metadata layer, JWT authentication, plan quotas, and Cloudflare R2 storage engine for the **FlipView PDF Digital Flipbook Platform**.

---

## 🌟 Architecture Overview

```text
                Blogger (`flipviewpdf.blogspot.com`) / Windows App (WinUI 3)
                                 |
                     FlipView Client / Theme JavaScript
                                 |
                                 v
                    FlipView Backend API (`/api/*`)
                                 |
             +-------------------+-------------------+
             |                                       |
             v                                       v
     Cloudflare R2 Storage                    SQLite Database
    (PDFs & Cover Previews)               (Multi-Tenant Metadata)
```

---

## 🚀 Phase 2 Features

1. **JWT Authentication & Multi-Tenancy**:
   - Short-lived Access Tokens (15 min) + Refresh Tokens (30 days).
   - Refresh token hashes persisted in `sessions` table.
   - Salted `bcryptjs` password hashing (zero plaintext/leaked passwords).
2. **User Ownership & Isolation**:
   - Publications belong to authenticated users (`user_id`).
   - `GET /api/publications` returns user's publications when authenticated, and public published feed when anonymous.
   - Ownership protection middleware (`requirePublicationOwner`) prevents cross-user tampering.
3. **Configurable Plan System**:
   - `FREE`: 5 publications, 100 MB storage, 25 MB max PDF size, 30 max pages, FlipView watermark.
   - `PRO`: 250 publications, 10 GB storage, 200 MB max PDF size, 1,000 max pages, white-label branding, password protection, analytics.
   - `BUSINESS`: 1,000 publications, 50 GB storage, 500 MB max PDF size, 2,500 max pages, white-label branding.
4. **Atomic Storage & Publication Counter**:
   - `storage_used_bytes` and `publication_count` automatically incremented on create and decremented on delete.
5. **Full Backward Compatibility**:
   - All legacy publications assigned to `usr_system_admin`.
   - Blogger public viewer and on-site chunk uploader continue to work without breaking changes.
6. **Security Hardening**:
   - Rate limiting on `/api/auth/*` against brute-force attacks.
   - Protected `PATCH /api/publications/:id` and `DELETE /api/publications/:id`.
   - Sanitized `.env.example`.

---

## 📡 REST API Reference

### Authentication Endpoints (`/api/auth/*`)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{ email, password, full_name }` | Register new user account |
| `POST` | `/api/auth/login` | `{ email, password, client_type }` | Authenticate user & issue JWT pair |
| `GET` | `/api/auth/me` | *Header: Bearer JWT* | Get active user profile, plan & storage quota |
| `POST` | `/api/auth/refresh` | `{ refreshToken }` | Generate fresh access token & rotate session |
| `POST` | `/api/auth/logout` | `{ refreshToken }` | Revoke session |
| `GET` | `/api/auth/plans` | *Public* | List available plan tiers & limits |

### Modernized Upload Endpoints (`/api/uploads/*` — Phase 3)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/uploads/init` | **Bearer JWT** | Initialize chunked session, validate plan quotas, allocate ID |
| `POST` | `/api/uploads/chunk` | **Bearer JWT** | Upload 2MB binary chunk slice to temporary disk storage |
| `POST` | `/api/uploads/complete` | **Bearer JWT** | Assemble PDF, inspect pages, stream to R2 (`users/{userId}/...`), update quota |
| `DELETE` | `/api/uploads/:id` | **Bearer JWT** | Abort upload session, delete temporary chunks |

### Public Reader & Viewer Endpoints (`/api/public/*` & `/view/*` — Phase 4)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/view/:publicationId` | Public | Standalone HTML5/Canvas interactive 3D flipbook reader |
| `GET` | `/api/public/:publicationId` | Public | Sanitized reader metadata DTO (visibility and branding enforced) |
| `GET` | `/api/public/:publicationId/pdf` | Public / Token | CORS-enabled HTTP Range partial streaming (`200`/`206`) |
| `POST` | `/api/public/:publicationId/verify-password` | Public | Verify password and receive scoped short-lived viewer grant token |
| `GET` | `/api/public/:publicationId/cover` | Public | Public cover preview stream / SVG fallback |
| `POST` | `/api/analytics/view` | Public | Record reader telemetry (`VIEW`, `PAGE_TURN`, `DOWNLOAD`, `SHARE`, `QR_SCAN`) |

### Publications Endpoints (`/api/publications/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/publications` | Optional | List user's publications (or public catalog if unauthenticated) |
| `GET` | `/api/publications/categories` | Public | Get all distinct publication categories |
| `GET` | `/api/publications/:id` | Public | Get single publication metadata |
| `GET` | `/api/publications/:id/pdf` | Public | Stream / redirect PDF file with CORS headers |
| `GET` | `/api/publications/:id/cover` | Public | Stream / redirect cover preview |
| `POST` | `/api/upload-chunk` | Optional | Legacy chunked upload slice (Blogger compatibility) |
| `POST` | `/api/finalize-upload` | Optional | Legacy finalize upload (Blogger compatibility) |
| `POST` | `/api/upload` | Optional | Single multipart PDF upload (Legacy compatibility) |
| `PATCH` | `/api/publications/:id` | **Owner / Admin** | Update publication metadata |
| `DELETE` | `/api/publications/:id` | **Owner / Admin** | Delete publication from R2 & DB |
| `POST` | `/api/publications/:id/republish` | **Owner / Admin** | Retry Blogger publishing |

### Admin Endpoints (`/api/admin/*`)

| Method | Endpoint | Protection | Description |
|---|---|---|---|
| `GET` | `/api/admin/stats` | Admin JWT / Legacy Key | Storage usage, publication counts, and status metrics |
| `POST` | `/api/admin/migrate-github` | Admin JWT / Legacy Key | Run legacy GitHub to R2 migration (`{ dryRun: boolean }`) |

---

## ⚙️ Environment Variables

```bash
PORT=8080
NODE_ENV=production
APP_URL=https://publisher.convertlyfiles.com/
DATABASE_URL=./data/flipview.db

# JWT Security
JWT_SECRET=your_jwt_secret_key_min_32_chars
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_min_32_chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_DAYS=30

# Cloudflare R2 Storage
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=flipview-pdfs
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev

# Google Blogger API Integration (Optional)
BLOGGER_BLOG_ID=5830475951713053686
BLOGGER_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
BLOGGER_CLIENT_SECRET=your_google_client_secret
BLOGGER_REFRESH_TOKEN=your_google_refresh_token
BLOG_DOMAIN=flipviewpdf.blogspot.com

# Admin Protection
ADMIN_API_KEY=your_secure_admin_api_key
```
