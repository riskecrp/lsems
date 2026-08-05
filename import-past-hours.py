#!/usr/bin/env python3
"""Import past employee weekly hours from the Google Sheet spreadsheet data."""
import json, re, sqlite3
from datetime import date

DB_PATH    = '/opt/lsems/data/lsems.db'
SHEET_FILE = '/root/.claude/projects/-opt/823b1034-50af-4c3c-a6bc-5b90a76e9e6c/tool-results/mcp-claude_ai_Google_Drive-read_file_content-1778237412941.txt'

MONTH_IDX  = {m:i+1 for i,m in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}
MONTH_NAME = {v:k for k,v in MONTH_IDX.items()}

def parse_date(s):
    s = s.strip()
    # D/Mon/YYYY or DD/Mon/YYYY
    m = re.match(r'^(\d{1,2})/([A-Za-z]{3})/(\d{4})$', s)
    if m:
        return date(int(m.group(3)), MONTH_IDX[m.group(2).capitalize()], int(m.group(1)))
    # M/D/YYYY
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return None

def to_db_format(d):
    return f"{d.day:02d}/{MONTH_NAME[d.month]}/{d.year}"

def parse_row(line):
    cells = [c.strip() for c in line.split('|')]
    if cells and cells[0] == '': cells = cells[1:]
    if cells and cells[-1] == '': cells = cells[:-1]
    return cells

# Load spreadsheet
with open(SHEET_FILE) as f:
    data = json.load(f)
content = data['fileContent']

# Find Past Employees table
marker = '| Name | Date Separated | Exit Rank | Authorizer | Total Hours |'
idx = content.find(marker)
assert idx != -1, "Could not find Past Employees table"

lines = content[idx:].split('\n')

# Parse header -> week columns
header_cells = parse_row(lines[0])
raw_weeks    = header_cells[5:]                        # skip Name,Date,ExitRank,Auth,Total
sheet_weeks  = []
for rw in raw_weeks:
    d = parse_date(rw)
    sheet_weeks.append(d)    # may be None for truly unparseable entries

# Connect to DB
db   = sqlite3.connect(DB_PATH)
db.isolation_level = None

# Build date -> existing week_ending string map from DB
db_date_to_str = {}
for (we,) in db.execute("SELECT DISTINCT week_ending FROM employee_hours"):
    d = parse_date(we)
    if d:
        db_date_to_str[d] = we

# Resolve each sheet week to a DB string (use existing if found, else canonical)
def resolve_week(d):
    if d is None: return None
    if d in db_date_to_str:
        return db_date_to_str[d]
    return to_db_format(d)

week_strings = [resolve_week(d) for d in sheet_weeks]

# Parse data rows
inserted = errors = skipped_active = 0
emp_count = 0

for line in lines[2:]:   # skip header and :-: separator
    line = line.strip()
    if not line or not line.startswith('|'):
        break
    cells = parse_row(line)
    if len(cells) < 5:
        continue
    name = cells[0].strip()
    if not name or name.startswith(':-:') or name == 'NO_HEADER':
        continue

    # Skip if still active
    if db.execute("SELECT 1 FROM employees WHERE LOWER(name)=LOWER(?)", (name,)).fetchone():
        skipped_active += 1
        continue

    emp_count += 1
    for i, ws in enumerate(week_strings):
        if ws is None:
            continue
        cell_idx = i + 5
        if cell_idx >= len(cells):
            break
        val = cells[cell_idx].strip()
        if val == '' or val == ' ':
            continue   # blank = no entry
        try:
            hours = float(val)
        except ValueError:
            continue
        try:
            db.execute(
                "INSERT INTO employee_hours (employee_name, week_ending, hours) VALUES (?,?,?)"
                " ON CONFLICT(employee_name, week_ending) DO NOTHING",
                (name, ws, hours)
            )
            inserted += 1
        except Exception as e:
            print(f"  ERR {name}/{ws}: {e}")
            errors += 1

db.execute("PRAGMA wal_checkpoint")
db.close()

print(f"Done. Employees processed: {emp_count}  |  Rows inserted: {inserted}  |  Active skipped: {skipped_active}  |  Errors: {errors}")
