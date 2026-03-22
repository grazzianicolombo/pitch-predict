#!/usr/bin/env python3
"""Security Assessment Report — Pitch Predict"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from datetime import datetime

OUTPUT = "/Users/tennet/Claude/pitch-predict/security_assessment_pitch_predict.pdf"

# ── Color palette ─────────────────────────────────────────────────────────────
DARK       = colors.HexColor("#0F172A")
MID        = colors.HexColor("#1E293B")
ACCENT     = colors.HexColor("#EF4444")       # red
ORANGE     = colors.HexColor("#F97316")
YELLOW     = colors.HexColor("#EAB308")
GREEN      = colors.HexColor("#22C55E")
BLUE       = colors.HexColor("#3B82F6")
LIGHT_GRAY = colors.HexColor("#F1F5F9")
MID_GRAY   = colors.HexColor("#94A3B8")
WHITE      = colors.white

SEV_COLORS = {
    "CRITICAL": colors.HexColor("#7F1D1D"),
    "HIGH":     colors.HexColor("#B91C1C"),
    "MEDIUM":   colors.HexColor("#D97706"),
    "LOW":      colors.HexColor("#1D4ED8"),
    "INFO":     colors.HexColor("#374151"),
}
SEV_BG = {
    "CRITICAL": colors.HexColor("#FEE2E2"),
    "HIGH":     colors.HexColor("#FEE2E2"),
    "MEDIUM":   colors.HexColor("#FEF3C7"),
    "LOW":      colors.HexColor("#DBEAFE"),
    "INFO":     colors.HexColor("#F3F4F6"),
}

# ── Styles ─────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, **kw)

COVER_TITLE  = S("ct", fontName="Helvetica-Bold", fontSize=32, textColor=WHITE, leading=40, alignment=TA_LEFT)
COVER_SUB    = S("cs", fontName="Helvetica", fontSize=14, textColor=MID_GRAY, leading=20, alignment=TA_LEFT)
COVER_META   = S("cm", fontName="Helvetica", fontSize=11, textColor=MID_GRAY, leading=16)

H1           = S("h1", fontName="Helvetica-Bold", fontSize=18, textColor=DARK, leading=24, spaceBefore=20, spaceAfter=8)
H2           = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=DARK, leading=18, spaceBefore=14, spaceAfter=4)
BODY         = S("body", fontName="Helvetica", fontSize=10, textColor=MID, leading=15, spaceAfter=6, alignment=TA_JUSTIFY)
BODY_L       = S("bodyl", fontName="Helvetica", fontSize=10, textColor=MID, leading=15, spaceAfter=4)
CODE         = S("code", fontName="Courier", fontSize=8.5, textColor=colors.HexColor("#1E293B"),
                  backColor=LIGHT_GRAY, leading=13, spaceAfter=6,
                  leftIndent=10, rightIndent=10, borderPadding=(6,8,6,8))
LABEL        = S("lbl", fontName="Helvetica-Bold", fontSize=9, textColor=MID_GRAY, leading=12, spaceAfter=2)
FINDING_ID   = S("fid", fontName="Helvetica-Bold", fontSize=11, textColor=WHITE, leading=14)
FINDING_TITLE= S("ft",  fontName="Helvetica-Bold", fontSize=12, textColor=DARK, leading=16, spaceAfter=4)
SMALL        = S("sm",  fontName="Helvetica", fontSize=9, textColor=MID_GRAY, leading=12)
BULLET       = S("bul", fontName="Helvetica", fontSize=10, textColor=MID, leading=15, leftIndent=14, spaceAfter=3)
SECTION_HDR  = S("shdr", fontName="Helvetica-Bold", fontSize=10, textColor=WHITE, leading=14)

# ── Findings data ──────────────────────────────────────────────────────────────
findings = [
    {
        "id": "F-01", "severity": "HIGH",
        "title": "Command Injection via execSync with Unquoted Path",
        "owasp": "A03 – Injection (CWE-78)",
        "file": "routes/sources.js:236–244",
        "description": (
            "The route executes a Python script using execSync with archiveDir interpolated "
            "directly into the shell string. If archiveDir were ever influenced by user input, "
            "an attacker could inject arbitrary shell commands."
        ),
        "proof": "execSync(`python3 ${archiveDir}/scrape_website.py --since ${sinceStr} --workers 6`)",
        "impact": "Remote Code Execution on the server.",
        "remediation": (
            "Replace execSync with child_process.execFile() and pass arguments as an array:\n"
            "execFile('python3', [path.join(archiveDir,'scrape_website.py'),'--since',sinceStr,'--workers','6'])"
        ),
    },
    {
        "id": "F-02", "severity": "HIGH",
        "title": "Unsafe execSync with Unquoted archiveDir (Archive Stats)",
        "owasp": "A03 – Injection (CWE-78)",
        "file": "routes/agent.js:183–186",
        "description": (
            "Similar to F-01, a find command in the archive stats endpoint interpolates "
            "archiveDir without quoting. Any special characters in the path would break the "
            "command or allow injection."
        ),
        "proof": "execSync(`find ${archiveDir} -name text.txt | wc -l`)",
        "impact": "Arbitrary command execution if path contains shell metacharacters.",
        "remediation": "Use execFile or quote the path: `find '${archiveDir}' -name text.txt | wc -l`",
    },
    {
        "id": "F-03", "severity": "HIGH",
        "title": "Secrets Written to Disk in Plaintext via Setup Route",
        "owasp": "A02 – Cryptographic Failures (CWE-312)",
        "file": "routes/setup.js:16–75",
        "description": (
            "The PUT /api/setup/key endpoint allows superadmin users to update API keys, "
            "which are written to the .env file on disk in plaintext using fs.writeFileSync. "
            "Any file-system leak (backup, git snapshot, log) exposes all credentials."
        ),
        "proof": "fs.writeFileSync(ENV_PATH, raw, 'utf8')  // raw contains plaintext API keys",
        "impact": "Full credential exposure if file system is compromised.",
        "remediation": (
            "Remove the .env write path entirely. With Doppler now managing secrets, "
            "this endpoint should call the Doppler API to update secrets, "
            "or be disabled in production."
        ),
    },
    {
        "id": "F-04", "severity": "HIGH",
        "title": "Missing CSRF Protection on State-Changing Endpoints",
        "owasp": "A01 – Broken Access Control (CWE-352)",
        "file": "server.js:37–41",
        "description": (
            "No CSRF token middleware (e.g., csrf-sync) is present. "
            "POST/PUT/DELETE endpoints rely solely on Bearer token auth. "
            "If the token is stored in localStorage (common), XSS can steal it; "
            "if in a cookie, CSRF is directly exploitable."
        ),
        "proof": "app.use(cors({ credentials: true, ... }))  // no csrf() middleware",
        "impact": "CSRF attacks can perform state-changing operations on behalf of authenticated users.",
        "remediation": (
            "If tokens are in Bearer headers only (not cookies), CSRF risk is low — "
            "but document this explicitly and ensure tokens are NEVER stored in cookies. "
            "Add double-submit cookie pattern or SameSite=Strict cookies as defense in depth."
        ),
    },
    {
        "id": "F-05", "severity": "HIGH",
        "title": "Missing Authorization Check on User Update (Potential IDOR)",
        "owasp": "A01 – Broken Access Control (CWE-639)",
        "file": "routes/auth.js:318–336",
        "description": (
            "PATCH /api/auth/users/:id validates superadmin role but does not verify "
            "that the :id exists before attempting the update. Supabase returns no error on "
            "an update that matches zero rows — the operation silently succeeds."
        ),
        "proof": "await supabase.from('user_profiles').update(updates).eq('id', id)  // no existence check",
        "impact": "Superadmin can silently attempt to update arbitrary UUIDs without feedback.",
        "remediation": (
            "Fetch the user first:\n"
            "const { data } = await supabase.from('user_profiles').select('id').eq('id',id).single();\n"
            "if (!data) return res.status(404).json({ error: 'User not found' });"
        ),
    },
    {
        "id": "F-06", "severity": "MEDIUM",
        "title": "No Rate Limiting on Authentication Endpoints",
        "owasp": "A07 – Identification and Authentication Failures (CWE-770)",
        "file": "routes/auth.js:45–108",
        "description": (
            "Login (/login), refresh (/refresh), forgot-password, and set-password "
            "endpoints have no rate limiting. An attacker can perform unlimited brute-force "
            "attempts against credentials."
        ),
        "proof": "router.post('/login', async (req, res) => { ... })  // no rate limiter",
        "impact": "Credential brute-force attacks; account takeover.",
        "remediation": (
            "Install express-rate-limit and apply to auth routes:\n"
            "const limiter = rateLimit({ windowMs: 15*60*1000, max: 10 });\n"
            "router.post('/login', limiter, ...)"
        ),
    },
    {
        "id": "F-07", "severity": "MEDIUM",
        "title": "Unbound Query limit Parameter — Resource Exhaustion",
        "owasp": "A05 – Security Misconfiguration (CWE-400)",
        "file": "routes/fields.js:40–46",
        "description": (
            "The GET /api/fields/events endpoint passes the limit query param directly to "
            "Supabase without an upper bound. An attacker can request limit=999999, "
            "exhausting database and application memory."
        ),
        "proof": ".limit(parseInt(limit))  // no max enforcement",
        "impact": "Denial of Service via resource exhaustion.",
        "remediation": "const safe = Math.min(parseInt(req.query.limit) || 50, 1000);",
    },
    {
        "id": "F-08", "severity": "MEDIUM",
        "title": "Race Condition in Job Scheduling",
        "owasp": "A04 – Insecure Design (CWE-362)",
        "file": "routes/agent.js:30–57",
        "description": (
            "Job creation checks for a running job then inserts a new one — "
            "these two operations are not atomic. Under concurrent requests, "
            "two callers could pass the check simultaneously and spawn duplicate jobs."
        ),
        "proof": "const running = Object.values(jobs).find(j => j.status === 'running');\n// gap here\njobs[jobId] = { status: 'running', ... }",
        "impact": "Duplicate long-running agent jobs; inconsistent state; doubled API costs.",
        "remediation": "Use a simple mutex (async-lock package) around the check-and-create block.",
    },
    {
        "id": "F-09", "severity": "MEDIUM",
        "title": "CORS Falls Back to Localhost in Misconfigured Production",
        "owasp": "A05 – Security Misconfiguration (CWE-942)",
        "file": "server.js:31–35",
        "description": (
            "If ALLOWED_ORIGINS is unset in production, the server adds localhost:5173 "
            "and localhost:3000 to the allowed list instead of rejecting all cross-origin "
            "requests. A warning is logged but the process continues."
        ),
        "proof": "if (allowedOrigins.length === 0) { allowedOrigins.push('http://localhost:5173', ...); }",
        "impact": "In a misconfigured production deployment, CORS is silently permissive.",
        "remediation": (
            "Fail hard if NODE_ENV=production and ALLOWED_ORIGINS is empty:\n"
            "if (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV === 'production') throw new Error('ALLOWED_ORIGINS required');"
        ),
    },
    {
        "id": "F-10", "severity": "MEDIUM",
        "title": "Missing Input Validation on Brand and Agency Creation",
        "owasp": "A03 – Injection (CWE-20)",
        "file": "routes/brands.js:27–40, routes/agencies.js:16–25",
        "description": (
            "POST /api/brands and POST /api/agencies accept fields like website, "
            "linkedin_company_url, and notes without any format validation or sanitization. "
            "Malformed URLs or XSS payloads could be stored and later reflected to users."
        ),
        "proof": "const { name, segment, website, notes } = req.body;\nawait supabase.from('brands').insert({ name, segment, website, notes })",
        "impact": "Stored XSS; data corruption; malformed URLs surfaced to frontend.",
        "remediation": "Validate URL fields with new URL(website); sanitize free-text fields against XSS.",
    },
    {
        "id": "F-11", "severity": "MEDIUM",
        "title": "File Upload — No Magic-Byte Validation",
        "owasp": "A04 – Insecure Design (CWE-434)",
        "file": "routes/sources.js:192–216",
        "description": (
            "PDF uploads are accepted based on the declared MIME type only. "
            "An attacker can rename a malicious file to .pdf and bypass the "
            "mimetype filter, as multer does not inspect file contents."
        ),
        "proof": "fileFilter: (req, file, cb) => {\n  if (file.mimetype !== 'application/pdf') cb(new Error('Só PDF'));\n  else cb(null, true);\n}",
        "impact": "Server-side execution of malicious files if the file is later processed.",
        "remediation": "Read first 4 bytes and validate PDF magic number: 25 50 44 46 (%PDF).",
    },
    {
        "id": "F-12", "severity": "MEDIUM",
        "title": "API Key Partial Exposure in GET /api/setup Response",
        "owasp": "A02 – Cryptographic Failures (CWE-200)",
        "file": "routes/setup.js:43–75",
        "description": (
            "The GET /api/setup endpoint returns masked API keys showing the first 8 "
            "and last 4 characters. This leaks enough structure to aid targeted phishing "
            "or social engineering attacks referencing real key fragments."
        ),
        "proof": "key.slice(0,8) + '••••••••••••' + key.slice(-4)",
        "impact": "Credential fragment disclosure to any authenticated user.",
        "remediation": "Return only configured: true/false instead of any key fragment.",
    },
    {
        "id": "F-13", "severity": "MEDIUM",
        "title": "Insufficient Session Expiration on Token Refresh",
        "owasp": "A07 – Identification and Authentication Failures (CWE-613)",
        "file": "routes/auth.js:82–108",
        "description": (
            "The refresh endpoint delegates expiration checks to Supabase but does not "
            "implement server-side refresh token rotation tracking, making stolen "
            "refresh tokens usable until Supabase-side expiry."
        ),
        "proof": "const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token })",
        "impact": "Stolen refresh tokens remain valid for their full lifetime.",
        "remediation": (
            "Implement refresh token rotation: on each refresh, invalidate the old token "
            "and issue a new one. Log refresh events for anomaly detection."
        ),
    },
    {
        "id": "F-14", "severity": "LOW",
        "title": "Weak Minimum Password Length (8 characters)",
        "owasp": "A07 – Identification and Authentication Failures (CWE-521)",
        "file": "routes/auth.js:224, 306",
        "description": "Passwords are accepted at 8 characters with no complexity requirements. NIST SP 800-63B recommends 12+ characters.",
        "proof": "if (!password || password.length < 8) { ... }",
        "impact": "Increased susceptibility to brute-force and dictionary attacks.",
        "remediation": "Require minimum 12 characters and at least one digit and one uppercase letter.",
    },
    {
        "id": "F-15", "severity": "LOW",
        "title": "Swallowed Errors in requireAuth Middleware",
        "owasp": "A09 – Security Logging and Monitoring Failures (CWE-209)",
        "file": "lib/auth.js:58–60",
        "description": (
            "The catch block in requireAuth returns a generic 401 but never logs "
            "the actual error. Supabase token validation failures are silently discarded, "
            "making it impossible to detect or investigate auth anomalies."
        ),
        "proof": "catch (e) { return res.status(401).json({ error: 'Erro ao validar token' }) }",
        "impact": "No visibility into auth failures; attacks go undetected.",
        "remediation": "console.error('[auth] validation error:', e.message, e.code); before returning 401.",
    },
    {
        "id": "F-16", "severity": "LOW",
        "title": "Unvalidated Weight Values in Variables and Fields",
        "owasp": "A03 – Injection (CWE-20)",
        "file": "routes/variables.js:11–19, routes/fields.js:15–24",
        "description": "The weight parameter is stored without bounds checking. Negative or arbitrarily large values could skew prediction model outputs.",
        "proof": "const { name, weight, type, description, active } = req.body;\nawait supabase.from('model_variables').insert({ name, weight, ... })",
        "impact": "Model integrity degradation; potential for adversarial prediction manipulation.",
        "remediation": "if (weight < 0 || weight > 100) return res.status(400).json({ error: 'Weight must be 0-100' });",
    },
    {
        "id": "F-17", "severity": "LOW",
        "title": "No Server-Side Security Headers",
        "owasp": "A05 – Security Misconfiguration",
        "file": "server.js",
        "description": (
            "No HTTP security headers are set (Content-Security-Policy, X-Frame-Options, "
            "X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy). "
            "These are standard defensive headers."
        ),
        "proof": "// No helmet() or manual header middleware present",
        "impact": "Clickjacking, MIME sniffing attacks, missing HSTS on HTTPS deployment.",
        "remediation": "Install and configure helmet: app.use(require('helmet')());",
    },
    {
        "id": "F-18", "severity": "LOW",
        "title": "Background Job Error Handling Not Fault-Tolerant",
        "owasp": "A09 – Security Logging and Monitoring Failures (CWE-248)",
        "file": "routes/sources.js:69–101, routes/agent.js:32–57",
        "description": (
            "If the catch block inside a background job itself throws (e.g., Supabase unreachable), "
            "the error is completely lost — no log, no alert, no status update."
        ),
        "proof": "catch (e) {\n  await supabase.from('source_jobs').update(...)  // this can also throw\n  console.error(...)\n}",
        "impact": "Silent job failures; no operational visibility.",
        "remediation": "Wrap the catch body in its own try-catch to guarantee logging even if Supabase is down.",
    },
]

# ── Counts ─────────────────────────────────────────────────────────────────────
from collections import Counter
sev_count = Counter(f["severity"] for f in findings)

# ── Build PDF ──────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="Security Assessment — Pitch Predict",
    author="Red & Blue Team Assessment",
)

W, H = A4
CONTENT_W = W - 4*cm

story = []

# ── Cover page ─────────────────────────────────────────────────────────────────
def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DARK)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # accent bar
    canvas.setFillColor(ACCENT)
    canvas.rect(0, H - 0.6*cm, W, 0.6*cm, fill=1, stroke=0)
    # side accent
    canvas.setFillColor(ACCENT)
    canvas.rect(0, 0, 0.4*cm, H, fill=1, stroke=0)
    canvas.restoreState()

cover_data = [
    Spacer(1, 3.5*cm),
    Paragraph("SECURITY ASSESSMENT", S("x", fontName="Helvetica-Bold", fontSize=11, textColor=ACCENT, leading=14)),
    Spacer(1, 0.5*cm),
    Paragraph("Pitch Predict", COVER_TITLE),
    Spacer(1, 0.4*cm),
    Paragraph("Full Application Penetration Test Report", COVER_SUB),
    Spacer(1, 2*cm),
    HRFlowable(width=CONTENT_W, thickness=1, color=colors.HexColor("#334155")),
    Spacer(1, 1*cm),
    Paragraph(f"Date: {datetime.now().strftime('%B %d, %Y')}", COVER_META),
    Paragraph("Scope: Backend API (Node.js/Express) — All routes and agents", COVER_META),
    Paragraph("Methodology: OWASP Top 10 2021 + CWE + Red/Blue Team manual review", COVER_META),
    Spacer(1, 2*cm),
    # severity summary table on cover
]

# severity summary
sum_data = [["Severity", "Count", "Status"]]
for sev, color in [("CRITICAL",ACCENT),("HIGH",ORANGE),("MEDIUM",YELLOW),("LOW",BLUE)]:
    cnt = sev_count.get(sev, 0)
    status = "⚠ Immediate action" if sev in ("CRITICAL","HIGH") else ("Remediate soon" if sev == "MEDIUM" else "Monitor")
    sum_data.append([sev, str(cnt), status])

sum_table = Table(sum_data, colWidths=[5*cm, 3*cm, 7.5*cm])
sum_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1E293B")),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 10),
    ("FONTNAME",   (0,1), (-1,-1), "Helvetica"),
    ("TEXTCOLOR",  (0,1), (-1,-1), MID_GRAY),
    ("BACKGROUND", (0,1), (-1,-1), colors.HexColor("#0F172A")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#0F172A"), colors.HexColor("#1E293B")]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#334155")),
    ("ALIGN",      (1,0), (1,-1), "CENTER"),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 7),
    ("BOTTOMPADDING", (0,0), (-1,-1), 7),
    ("LEFTPADDING",(0,0), (-1,-1), 12),
]))

cover_data.append(sum_table)
cover_data.append(Spacer(1, 1.5*cm))
cover_data.append(Paragraph(f"Total findings: {len(findings)}", COVER_META))

story.extend(cover_data)
story.append(PageBreak())

# ── Executive Summary ──────────────────────────────────────────────────────────
story.append(Paragraph("Executive Summary", H1))
story.append(HRFlowable(width=CONTENT_W, thickness=1.5, color=ACCENT, spaceAfter=10))

story.append(Paragraph(
    "A comprehensive security assessment was performed against the Pitch Predict backend API "
    "(Node.js / Express). The review covered all route handlers, authentication middleware, "
    "background agents, crawler scripts, and server configuration using the OWASP Top 10 2021 "
    "framework, CWE taxonomy, and adversarial red/blue team perspective.",
    BODY
))
story.append(Paragraph(
    f"A total of <b>{len(findings)} findings</b> were identified: "
    f"<b>{sev_count.get('CRITICAL',0)} Critical</b>, "
    f"<b>{sev_count.get('HIGH',0)} High</b>, "
    f"<b>{sev_count.get('MEDIUM',0)} Medium</b>, "
    f"<b>{sev_count.get('LOW',0)} Low</b>.",
    BODY
))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph("Key Risk Areas", H2))
risks = [
    ("Command Injection", "Two execSync calls interpolate unsanitized path variables directly into shell strings (F-01, F-02). These are the highest-priority findings."),
    ("Secrets on Disk", "The setup route writes API keys to .env in plaintext. Now that Doppler is in place, this code path should be removed (F-03)."),
    ("Authentication", "No rate limiting on login, refresh, or password reset endpoints leaves them open to brute-force attacks (F-06)."),
    ("Denial of Service", "The limit query parameter is passed unbounded to the database, allowing resource exhaustion (F-07)."),
    ("Security Headers", "No HTTP security headers (helmet) are configured, exposing the API to clickjacking and MIME sniffing (F-17)."),
]
for title, desc in risks:
    story.append(Paragraph(f"<b>{title}:</b> {desc}", BULLET))

story.append(Spacer(1, 0.5*cm))

# Risk matrix table
story.append(Paragraph("Finding Distribution", H2))
matrix_data = [["ID", "Title", "Severity", "OWASP"]]
for f in findings:
    matrix_data.append([
        f["id"],
        f["title"][:55] + ("…" if len(f["title"]) > 55 else ""),
        f["severity"],
        f["owasp"][:35] + ("…" if len(f["owasp"]) > 35 else ""),
    ])

matrix = Table(matrix_data, colWidths=[1.4*cm, 7.5*cm, 2.2*cm, 4.4*cm])
sev_row_colors = {"CRITICAL": SEV_BG["CRITICAL"], "HIGH": SEV_BG["HIGH"],
                   "MEDIUM": SEV_BG["MEDIUM"], "LOW": SEV_BG["LOW"]}
row_styles = [
    ("BACKGROUND", (0,0), (-1,0), MID),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 8.5),
    ("FONTNAME",   (0,1), (-1,-1), "Helvetica"),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#CBD5E1")),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ("LEFTPADDING",(0,0), (-1,-1), 6),
    ("ALIGN",      (0,0), (0,-1), "CENTER"),
    ("ALIGN",      (2,0), (2,-1), "CENTER"),
]
for i, f in enumerate(findings, 1):
    bg = sev_row_colors.get(f["severity"], LIGHT_GRAY)
    row_styles.append(("BACKGROUND", (2,i), (2,i), SEV_COLORS[f["severity"]]))
    row_styles.append(("TEXTCOLOR",  (2,i), (2,i), WHITE))
    row_styles.append(("FONTNAME",   (2,i), (2,i), "Helvetica-Bold"))

matrix.setStyle(TableStyle(row_styles))
story.append(matrix)
story.append(PageBreak())

# ── Individual Findings ────────────────────────────────────────────────────────
story.append(Paragraph("Detailed Findings", H1))
story.append(HRFlowable(width=CONTENT_W, thickness=1.5, color=ACCENT, spaceAfter=12))

for idx, f in enumerate(findings):
    sev = f["severity"]
    sev_color = SEV_COLORS[sev]
    sev_bg    = SEV_BG[sev]

    block = []

    # Header bar
    header_data = [[
        Paragraph(f["id"], FINDING_ID),
        Paragraph(sev, S("sx", fontName="Helvetica-Bold", fontSize=10, textColor=WHITE, alignment=TA_CENTER)),
    ]]
    header_table = Table(header_data, colWidths=[1.8*cm, CONTENT_W - 1.8*cm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), sev_color),
        ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LEFTPADDING",(0,0), (0,-1), 12),
        ("ALIGN",      (1,0), (1,-1), "RIGHT"),
        ("RIGHTPADDING",(1,0),(1,-1), 12),
    ]))
    block.append(header_table)

    # Title + meta
    meta_data = [[
        Paragraph(f["title"], FINDING_TITLE),
    ]]
    meta_table = Table([[
        Paragraph(f["title"], FINDING_TITLE),
    ]], colWidths=[CONTENT_W])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), sev_bg),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LEFTPADDING",(0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0),(-1,-1), 12),
    ]))
    block.append(meta_table)

    # Meta row
    meta2 = Table([[
        Paragraph(f"<b>OWASP:</b> {f['owasp']}", SMALL),
        Paragraph(f"<b>File:</b> {f['file']}", SMALL),
    ]], colWidths=[CONTENT_W*0.5, CONTENT_W*0.5])
    meta2.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), sev_bg),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LEFTPADDING",(0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0),(-1,-1), 12),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ]))
    block.append(meta2)

    # Content sections
    def section(label, text, is_code=False):
        rows = [
            [Paragraph(label, LABEL)],
            [Paragraph(text, CODE if is_code else BODY_L)],
        ]
        t = Table(rows, colWidths=[CONTENT_W])
        t.setStyle(TableStyle([
            ("LEFTPADDING",(0,0),(-1,-1), 0),
            ("RIGHTPADDING",(0,0),(-1,-1), 0),
            ("TOPPADDING",(0,0),(-1,-1), 2),
            ("BOTTOMPADDING",(0,0),(-1,-1), 2),
        ]))
        return t

    block.append(Spacer(1, 0.3*cm))
    block.append(section("DESCRIPTION", f["description"]))
    block.append(section("PROOF OF CONCEPT", f["proof"].replace("\n", "<br/>"), is_code=True))
    block.append(section("IMPACT", f["impact"]))
    block.append(section("REMEDIATION", f["remediation"].replace("\n", "<br/>")))
    block.append(Spacer(1, 0.5*cm))

    if idx < len(findings) - 1:
        block.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=LIGHT_GRAY, spaceAfter=6))

    story.append(KeepTogether(block[:4]))  # keep header+title together
    story.extend(block[4:])

# ── Remediation Roadmap ────────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph("Remediation Roadmap", H1))
story.append(HRFlowable(width=CONTENT_W, thickness=1.5, color=ACCENT, spaceAfter=12))

roadmap = [
    ("Immediate (0–3 days)", "CRITICAL / HIGH", ACCENT, [
        "F-01 & F-02: Replace execSync shell interpolation with execFile()",
        "F-03: Remove .env write path from setup route — use Doppler API instead",
        "F-04: Document and enforce Bearer-only auth; add SameSite=Strict cookie policy",
        "F-05: Add existence check before user update operations",
    ]),
    ("Short-term (1–2 weeks)", "MEDIUM", ORANGE, [
        "F-06: Add express-rate-limit to all auth endpoints (max 10 req / 15 min)",
        "F-07: Enforce max limit=1000 on all paginated queries",
        "F-08: Add async-lock mutex around job creation",
        "F-09: Fail hard if ALLOWED_ORIGINS is unset in production",
        "F-10: Validate URL fields and sanitize free-text inputs",
        "F-11: Validate PDF magic bytes on upload",
        "F-12: Return only configured: true/false for API keys — remove partial masking",
        "F-13: Implement refresh token rotation and logging",
    ]),
    ("Medium-term (2–4 weeks)", "LOW", BLUE, [
        "F-14: Increase minimum password length to 12 chars + complexity",
        "F-15: Log auth errors server-side (never expose to client)",
        "F-16: Enforce weight bounds 0–100 on model variables",
        "F-17: Install helmet() for all security headers (CSP, HSTS, X-Frame-Options)",
        "F-18: Fault-tolerant catch blocks in all background jobs",
    ]),
]

for phase, sev_label, color, items in roadmap:
    phase_data = [[
        Paragraph(phase, S("ph", fontName="Helvetica-Bold", fontSize=11, textColor=WHITE)),
        Paragraph(sev_label, S("ph2", fontName="Helvetica", fontSize=10, textColor=WHITE, alignment=TA_CENTER)),
    ]]
    pt = Table(phase_data, colWidths=[CONTENT_W*0.7, CONTENT_W*0.3])
    pt.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), color),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LEFTPADDING",(0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0),(-1,-1), 12),
        ("ALIGN",(1,0),(1,-1),"RIGHT"),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ]))
    story.append(pt)
    for item in items:
        story.append(Paragraph(f"• {item}", BULLET))
    story.append(Spacer(1, 0.5*cm))

# ── Footer note ────────────────────────────────────────────────────────────────
story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=MID_GRAY))
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph(
    "This report reflects findings at the time of assessment. Re-assess after remediation is applied. "
    "Findings marked CRITICAL and HIGH must be remediated before next production deployment.",
    SMALL
))

# ── Page numbers ───────────────────────────────────────────────────────────────
def add_page_number(canvas, doc):
    if doc.page == 1:
        draw_cover(canvas, doc)
        return
    canvas.saveState()
    canvas.setFillColor(MID_GRAY)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(W - 2*cm, 1.2*cm, f"Page {doc.page}  |  Pitch Predict — Security Assessment")
    canvas.setFillColor(ACCENT)
    canvas.rect(0, 0, 0.3*cm, H, fill=1, stroke=0)
    canvas.restoreState()

def add_cover_and_number(canvas, doc):
    draw_cover(canvas, doc)
    canvas.saveState()
    canvas.setFillColor(MID_GRAY)
    canvas.setFont("Helvetica", 9)
    canvas.drawRightString(W - 2*cm, 1.2*cm, "Pitch Predict — Security Assessment")
    canvas.restoreState()

doc.build(story, onFirstPage=add_cover_and_number, onLaterPages=add_page_number)
print(f"Report saved: {OUTPUT}")
