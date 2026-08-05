export const dynamic = 'force-static';

const S = {
  page:    { maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' },
  card:    { borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 2px 4px rgba(0,0,0,0.7), 0 8px 28px rgba(0,0,0,0.55)', marginBottom: 16, overflow: 'hidden', position: 'relative' },
  cardTop: { padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 10 },
  cardBody:{ padding: '18px 20px' },
  h1:      { fontSize: 22, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.2 },
  h2:      { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--c-accent)' },
  h3:      { fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6, marginTop: 16 },
  p:       { fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 10 },
  li:      { fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 4 },
  label:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-4)' },
  pill:    { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', border: '1px solid', whiteSpace: 'nowrap' },
  mono:    { fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-2)' },
  note:    { padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.6, marginTop: 10, marginBottom: 10 },
  toc:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, marginTop: 8 },
  tocItem: { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-sub)', fontSize: 12, color: 'var(--c-accent)', textDecoration: 'none', fontWeight: 600, transition: 'opacity 0.12s' },
};

function Card({ id, title, children }) {
  return (
    <div id={id} style={S.card}>
      <div style={S.cardTop}>
        <span style={S.h2}>{title}</span>
      </div>
      <div style={S.cardBody}>{children}</div>
    </div>
  );
}

function Note({ type = 'info', children }) {
  const colors = {
    info:    { bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.28)',   color: 'var(--c-success)' },
    warning: { bg: 'rgba(251,191,36,0.08)',   border: 'rgba(251,191,36,0.28)',   color: 'var(--c-warning)' },
    danger:  { bg: 'rgba(248,113,113,0.08)',  border: 'rgba(248,113,113,0.28)',  color: 'var(--c-danger)'  },
    tip:     { bg: 'rgba(128,0,0,0.10)',      border: 'rgba(180,30,30,0.30)',    color: 'var(--c-accent)'  },
  };
  const c = colors[type];
  return (
    <div style={{ ...S.note, background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {children}
    </div>
  );
}

function Field({ name, desc }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
      <span style={{ ...S.mono, flexShrink: 0, marginTop: 2 }}>{name}</span>
      <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{desc}</span>
    </div>
  );
}

function LevelBadge({ level, name, color }) {
  return (
    <span style={{ ...S.pill, color, borderColor: `${color}55`, background: `${color}15`, marginRight: 6 }}>
      L{level} — {name}
    </span>
  );
}

export default function GuidePage() {
  return (
    <div style={S.page}>

      {/* ── Hero ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div>
            <h1 style={S.h1}>LSEMS Dashboard Guide</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              Complete reference for the Los Santos Emergency Medical Services internal management suite.
            </p>
          </div>
        </div>

        {/* Table of contents */}
        <div style={{ ...S.card, marginBottom: 0 }}>
          <div style={S.cardTop}><span style={S.h2}>Contents</span></div>
          <div style={{ padding: '14px 20px' }}>
            <div style={S.toc}>
              {[
                ['#start',      'Getting Started'],
                ['#profile',    'Your Profile'],
                ['#levels',     'Permission Levels'],
                ['#roster',     'Roster'],
                ['#hours',      'Hours'],
                ['#payroll',    'Payroll'],
                ['#bonuses',    'Bonuses'],
                ['#operations', 'Operations & Tasks'],
                ['#history',    'Employee History'],
                ['#past',       'Past Employees'],
                ['#admin',      'Admin Panel'],
              ].map(([href, label]) => (
                <a key={href} href={href} style={S.tocItem}>{label}</a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Getting Started ── */}
      <Card id="start" title="Getting Started">
        <p style={S.p}>
          The LSEMS Dashboard is a private internal tool for managing LSEMS personnel, hours, payroll, and operations.
          Access is granted exclusively through Discord — you must be a member of the LSEMS Discord server with an
          assigned role to log in.
        </p>
        <div style={S.h3}>Logging In</div>
        <p style={S.p}>
          Navigate to the site and click <strong>Login with Discord</strong>. You will be redirected to Discord's OAuth
          page, then returned to the dashboard. Your permission level is determined automatically by your Discord roles —
          no manual setup is needed.
        </p>
        <Note type="tip">
          <strong>First time?</strong> After logging in, open your profile (click your username in the top-right) and
          set your <strong>Character Name</strong> before doing anything else. Many actions — promotions, separations,
          LOA entries — are logged under your character name as the authorizer.
        </Note>
        <div style={S.h3}>Navigation</div>
        <p style={S.p}>
          The navigation bar at the top shows every page your permission level can access. Pages you cannot access
          will not appear. Use <strong>View As</strong> (Admin page) to preview what lower-level users see.
        </p>
      </Card>

      {/* ── Your Profile ── */}
      <Card id="profile" title="Your Profile">
        <p style={S.p}>
          Click your Discord display name in the top-right corner to open the profile editor.
        </p>
        <Field name="Character Name"
          desc="Your in-character full name (e.g. CeeCee Rhodes). This is stamped as the authorizing officer on every action you take — promotions, separations, LOA entries, and more. Without it, most roster actions will fail." />
        <Field name="Signature Image URL"
          desc="A direct link to your signature image hosted on Imgur, ImgBB, or similar. This is automatically inserted into BBCode warning letters and other post templates generated by the dashboard." />
        <Note type="warning">
          Your character name must exactly match your name on the employee roster if you want rank lookups to work
          correctly in BBCode templates.
        </Note>
      </Card>

      {/* ── Permission Levels ── */}
      <Card id="levels" title="Permission Levels">
        <p style={S.p}>
          Access to pages and actions is controlled by your permission level, assigned via your Discord role.
          Higher levels inherit everything below them.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {[
            { lvl: 1, name: 'Supervisor', color: '#34d399', items: [
              'View the Roster, Hours, Operations, History, and Past Employees pages',
              'Add, edit, and delete tasks and discussions',
              'Mark discussion responses',
            ]},
            { lvl: 2, name: 'Command', color: '#fbbf24', items: [
              'Everything L1 can do',
              'View Payroll & Treasury, Bonuses, and Admin pages',
              'Add, promote, rename, separate employees and manage their LOA',
              'Submit payroll runs, add treasury entries, set balance',
              'Mark retention bonuses paid',
              'Generate and copy quarterly/warning BBCodes',
              'Edit Admin configuration: hour requirements, salaries, bonus cycle, BBCode templates',
            ]},
            { lvl: 3, name: 'High Command', color: '#f87171', items: [
              'Everything L2 can do',
              'Separate employees (permanent removal from roster)',
              'Delete treasury entries and delete entire hour weeks',
              'Access Control — configure what each level can see and do',
              'Discord Roles — assign levels to Discord role IDs',
              'Create custom permission levels',
              'View As — simulate any permission level for testing',
            ]},
          ].map(({ lvl, name, color, items }) => (
            <div key={lvl} style={{ padding: '12px 16px', borderRadius: 10, border: `1px solid ${color}33`, background: `${color}08` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <LevelBadge level={lvl} name={name} color={color} />
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {items.map((item, i) => <li key={i} style={S.li}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <Note type="tip">
          Custom levels (e.g. L4 — Consultant) can be created in <strong>Admin → Discord Roles</strong> and given
          granular per-action access in <strong>Admin → Access Control</strong>.
        </Note>
      </Card>

      {/* ── Roster ── */}
      <Card id="roster" title="Roster">
        <p style={S.p}>
          The Roster is the live list of all active LSEMS employees. It is the central hub for managing personnel.
        </p>

        <div style={S.h3}>Reading the Roster</div>
        <Field name="Name / Rank"    desc="The employee's in-character name and current rank. Click the name to open their full profile (hours history, bonus history, rank history, LOA history)." />
        <Field name="LOA indicator"  desc="If an employee is on approved Leave of Absence, their start and end dates appear under their name in amber." />
        <Field name="Hired / Promoted" desc="The date the employee was hired and the date they were last promoted to their current rank." />
        <Field name="Days in Rank"   desc="Number of days since their last promotion. Turns amber after 90 days as a visual prompt." />
        <Field name="Hours In Rank"  desc="Total logged hours since their most recent promotion date — used for promotion decisions." />
        <Field name="Total Hours"    desc="Cumulative hours across the employee's entire employment history." />

        <div style={S.h3}>Actions (L2+)</div>
        <Field name="Add Employee"   desc="Opens a form to hire a new employee. Requires character name, rank, and hire date. Automatically creates a rank history entry." />
        <Field name="Promote"        desc="Changes an employee's rank. Records the old and new rank in the rank history with a date stamp. Resets the 'hours in rank' counter." />
        <Field name="Rename"         desc="Updates the employee's name across all records — hours, rank history, bonus payments, past employee records." />
        <Field name="Remove"         desc="Permanently separates the employee. They move to the Past Employees archive with their total hours and exit rank preserved. Requires L3." />
        <Field name="Add / Adjust LOA" desc="Opens the LOA manager for that employee. Set start and end dates and an optional reason. End the LOA by clearing the dates." />

        <div style={S.h3}>Employee Profile (click any name)</div>
        <p style={S.p}>
          Clicking an employee's name opens a slide-out profile with four tabs:
        </p>
        <Field name="Hours"        desc="Every payroll week since their hire date. Weeks with an LOA active show an amber LOA badge. Missing entries show a dash. Color coding: green = met requirement, red = below requirement." />
        <Field name="Bonuses"      desc="Upcoming retention bonus milestone, days until it's due, and full payment history." />
        <Field name="Rank History" desc="Chronological log of every rank change with dates and the authorizing officer." />
        <Field name="LOA History"  desc="All LOA records pulled from the audit log." />

        <Note type="tip">
          The LOA bot automatically records LOAs posted in the Discord LOA channel and sets them on the matching
          employee. The dashboard syncs every 6 hours to clear expired LOAs.
        </Note>
      </Card>

      {/* ── Hours ── */}
      <Card id="hours" title="Hours">
        <p style={S.p}>
          The Hours page tracks weekly logged hours for every active employee. Hours are tied to payroll — when a
          payroll CSV is submitted, hours are written here automatically. They can also be edited manually.
        </p>

        <div style={S.h3}>The Grid</div>
        <p style={S.p}>
          Rows are employees (sorted by rank hierarchy). Columns are pay week ending dates, newest on the left.
          Use the <strong>Weeks</strong> buttons (4, 8, 12, 20, All) to control how many columns are shown.
          The search box filters rows by name.
        </p>

        <div style={S.h3}>Color Coding</div>
        <Field name="Green"  desc="Hours meet or exceed the requirement for that rank." />
        <Field name="Yellow" desc="Hours are above the minimum but below the goal (applies to Command and High Command ranks which have a 5h minimum and 10h goal)." />
        <Field name="Red"    desc="Hours are below the minimum requirement." />
        <Field name="Dash"   desc="No entry exists for that week — the employee may not have been on the roster yet." />

        <div style={S.h3}>Editing Hours</div>
        <p style={S.p}>
          Click any cell to edit it inline. Press <span style={S.mono}>Enter</span> to save or{' '}
          <span style={S.mono}>Escape</span> to cancel. Clear a cell entirely and press Enter to delete that week's
          entry for that employee. Each save is immediately reflected in the color coding.
        </p>

        <div style={S.h3}>Deleting Weeks</div>
        <p style={S.p}>
          Each week column header has a small <span style={S.mono}>✕</span> button that deletes <em>all</em> hours
          for that entire pay week. This requires L3 by default. Use with caution — this cannot be undone.
        </p>

        <div style={S.h3}>Non-Compliance Tab</div>
        <p style={S.p}>
          Shows the two most recent pay weeks. For each, lists every employee who did not meet their hour requirement,
          their logged hours, and whether they had an active LOA that week. Employees on LOA are shown in amber and
          excluded from active non-compliance counts.
        </p>

        <div style={S.h3}>Warning BBCode Buttons</div>
        <p style={S.p}>
          Each employee in the non-compliance list has <span style={S.mono}>W1</span> and{' '}
          <span style={S.mono}>W2</span> copy buttons. Clicking either copies a fully formatted BBCode warning
          letter to your clipboard, pre-filled with the employee's name, their hour requirement, the pay week, today's
          date, and your character name, rank, and signature image from your profile.
        </p>
        <Note type="tip">
          Warning templates are fully customizable in <strong>Admin → BBCode Templates</strong>.
        </Note>

        <div style={S.h3}>Hour Requirements by Rank</div>
        <p style={S.p}>Hour requirements are configurable in the Admin panel. Default requirements:</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {[
            ['Chief / AC / DC / Commander / Captain / Lieutenant', '5h/week (goal: 10h)'],
            ['Lead / Senior / Paramedic / Junior Paramedic', '5h/week'],
            ['Master EMT / EMT-A / EMT-I / EMT-B / EMR', '2.5h/week'],
            ['EMT-P', '1h/month'],
          ].map(([rank, req]) => (
            <Field key={rank} name={req} desc={rank} />
          ))}
        </div>
      </Card>

      {/* ── Payroll ── */}
      <Card id="payroll" title="Payroll">
        <p style={S.p}>
          The Payroll page handles weekly pay runs and the LSEMS treasury ledger. Only L2+ can access this page.
        </p>

        <div style={S.h3}>Submitting a Pay Run</div>
        <p style={S.p}>
          Paste the raw CSV export from the payroll tracking sheet into the text area. The dashboard will parse it,
          match employees to the roster by name, calculate pay from configured hourly rates, and show a preview table.
        </p>
        <p style={S.p}>Expected CSV columns (in order):</p>
        <div style={{ ...S.note, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8 }}>
          Name, Hours (or Pay, Amount — any numeric column after the name is treated as hours)
        </div>
        <p style={S.p}>
          Employees in the CSV who are not on the roster are flagged. You can add them to the roster inline from the
          payroll review screen. After review, click <strong>Submit Pay Run</strong> to:
        </p>
        <ul style={{ paddingLeft: 20, marginBottom: 10 }}>
          <li style={S.li}>Write hours to the Hours grid for every employee</li>
          <li style={S.li}>Write zero hours for any active employee not in the CSV</li>
          <li style={S.li}>Deduct the total payroll amount from the treasury balance</li>
          <li style={S.li}>Create a treasury ledger entry</li>
        </ul>
        <Note type="warning">
          The week date entered must be unique. Submitting the same week date twice will overwrite any existing hours
          for that week.
        </Note>

        <div style={S.h3}>Treasury Ledger</div>
        <p style={S.p}>
          The right column shows the full treasury transaction history. Each entry shows the type, amount, resulting
          balance, timestamp, and optional notes. Use the <strong>+ Add Entry</strong> button for manual credits or
          debits (e.g. fines, deposits, special expenses). Use <strong>Set Balance</strong> to correct the opening
          balance if it drifts out of sync.
        </p>

        <div style={S.h3}>Hourly Rates</div>
        <p style={S.p}>
          Configurable per rank in <strong>Admin → Salaries</strong>. The dashboard multiplies each employee's hours
          by their rank's hourly rate to calculate their weekly pay.
        </p>
      </Card>

      {/* ── Bonuses ── */}
      <Card id="bonuses" title="Bonuses">
        <p style={S.p}>
          The Bonuses page manages two separate bonus systems: Quarterly performance bonuses and tenure-based
          Retention bonuses.
        </p>

        <div style={S.h3}>Quarterly Bonuses Tab</div>
        <p style={S.p}>
          Reviews the last 4 weeks of hours to determine which employees met the 75% compliance threshold
          (e.g. if the requirement is 4 × 5h = 20h, the threshold is 15h). Employees below threshold are listed
          in the non-compliance section where you can mark each as <strong>Recommended</strong> or{' '}
          <strong>Not Recommended</strong> for their bonus, with a required reason note for non-recommendations.
        </p>

        <div style={S.h3}>Bonus Table</div>
        <p style={S.p}>
          The Bonus Table auto-populates with every rank present on the roster and their live headcount.
          Enter the bonus amount per rank — the table calculates each rank's total and the grand total automatically.
          This data fills the BBCode post.
        </p>

        <div style={S.h3}>Copy BBCode</div>
        <p style={S.p}>
          Generates a fully formatted BBCode forum post containing the bonus table, the list of employees not
          receiving bonuses with reasons, and any exception recommendations. The template is customizable in{' '}
          <strong>Admin → BBCode Templates → Quarterly Bonuses</strong>.
        </p>

        <div style={S.h3}>Retention Bonuses Tab</div>
        <p style={S.p}>
          Tracks each employee's tenure milestones. The dashboard calculates how many days each employee has been
          employed and flags those due for a retention bonus payment. Milestones are configurable in{' '}
          <strong>Admin → Bonus Cycle</strong> (defaults: 3, 6, 9, and 12 months).
        </p>
        <Field name="Due Now"  desc="Employees whose next milestone has passed and the bonus has not been paid. Shown as a red badge." />
        <Field name="Due Soon" desc="Employees within 30 days of their next milestone. Shown as amber." />
        <p style={S.p}>
          Click an employee's milestone badge to open the payment modal. Confirming records the payment, creates a
          treasury deduction entry, and removes the badge from the Due list.
        </p>

        <div style={S.h3}>Payment History Tab</div>
        <p style={S.p}>
          Full ledger of all retention bonus payments — employee name, milestone month, amount, and paid date.
        </p>
      </Card>

      {/* ── Operations ── */}
      <Card id="operations" title="Operations & Tasks">
        <p style={S.p}>
          The Operations page manages internal supervisor tasks and forum discussion tracking. It is accessible
          to all permission levels.
        </p>

        <div style={S.h3}>Tasks</div>
        <p style={S.p}>
          Tasks represent assigned work items. Each task has:
        </p>
        <Field name="Task Name"       desc="A short description of the assignment." />
        <Field name="Owner"           desc="The supervisor responsible for completing it." />
        <Field name="Status"          desc="Assigned → In Progress → Completed. Change status inline via the dropdown in the task row." />
        <Field name="Assigned Date"   desc="When the task was created (auto-filled, editable)." />
        <Field name="Due Date"        desc="Optional deadline. Overdue tasks are highlighted in red." />
        <Field name="Notes"           desc="Freeform notes. Expand a task row to show its notes." />

        <p style={S.p}>
          L1 users can add and update tasks. Deleting tasks requires L2+. The task stats header shows each supervisor's
          active and completed task counts.
        </p>

        <div style={S.h3}>Discussions</div>
        <p style={S.p}>
          Tracks which supervisors have responded to forum discussion posts. Add a discussion topic with a title and
          an optional link to the forum thread. Each discussion row expands to show a checkbox grid of all supervisors.
          Check a supervisor's box when they've responded — the badge updates in real time.
        </p>
        <Note type="tip">
          Supervisors on LOA are highlighted in the response grid so you know not to chase them for a response.
        </Note>
      </Card>

      {/* ── History ── */}
      <Card id="history" title="Employee History">
        <p style={S.p}>
          A full chronological log of every rank change across all employees. Each entry records:
        </p>
        <Field name="Date"        desc="When the rank change was recorded." />
        <Field name="Employee"    desc="The employee's name." />
        <Field name="From → To"   desc="The old rank and new rank. Hire entries show a blank old rank. Separation events show 'SEPARATED' as the new rank." />
        <Field name="Authorizer"  desc="The officer who authorized the change." />
        <p style={S.p}>
          The table is searchable and sortable. Use it to audit promotion history, verify tenure, or look up when
          someone was originally hired.
        </p>
      </Card>

      {/* ── Past Employees ── */}
      <Card id="past" title="Past Employees">
        <p style={S.p}>
          An archive of all employees who have been separated from LSEMS. Records are created automatically when
          an employee is removed from the Roster.
        </p>
        <Field name="Name"           desc="The employee's name at time of separation." />
        <Field name="Separation Date" desc="When they were removed." />
        <Field name="Exit Rank"       desc="The rank they held at the time of separation." />
        <Field name="Hire Date"       desc="Their original hire date (for tenure calculation)." />
        <Field name="Total Hours"     desc="Cumulative logged hours during their employment." />
        <Field name="Authorizer"      desc="The officer who authorized the separation." />
        <Note type="info">
          Past employee records are permanent and read-only. They cannot be edited or deleted from the dashboard.
        </Note>
      </Card>

      {/* ── Admin ── */}
      <Card id="admin" title="Admin Panel">
        <p style={S.p}>
          The Admin panel is accessible to L2+ and contains all system configuration. L3 (High Command) has
          access to the full panel including access control and Discord role assignments.
        </p>

        <div style={S.h3}>Hour Requirements</div>
        <p style={S.p}>
          Configure the minimum hours and optional goal hours per rank. The <strong>Type</strong> field can be
          set to Weekly or Monthly. The <strong>Min</strong> column sets the red threshold (below = non-compliant).
          The <strong>Goal</strong> column sets the yellow threshold (between min and goal = meeting minimum but
          below target — applies to Command and High Command ranks).
        </p>

        <div style={S.h3}>Salaries</div>
        <p style={S.p}>
          Set the hourly pay rate per rank used in payroll calculations. Changes take effect on the next
          payroll submission.
        </p>

        <div style={S.h3}>Bonus Cycle</div>
        <p style={S.p}>
          Define the retention bonus milestones. Each entry is a number of months of employment and the
          corresponding payout amount. Add or remove milestones freely. The Bonuses page uses these thresholds
          to calculate when each employee is next due.
        </p>

        <div style={S.h3}>BBCode Templates</div>
        <p style={S.p}>
          Edit the forum post templates used across the dashboard. Available templates:
        </p>
        <Field name="First Hour Warning"   desc="Sent to employees who have missed their weekly/monthly hour requirement for the first time. Copy button is on the Hours → Non-Compliance tab." />
        <Field name="Second Hour Warning"  desc="Sent on the second offence. Same copy button, W2 variant." />
        <Field name="Quarterly Bonuses"    desc="The full forum post generated by the Bonuses page. Contains the rank/amount table and compliance exception lists." />
        <p style={S.p}>
          Use placeholders to auto-fill content. Available placeholders vary by template — they are listed below
          the editor as clickable chips. Common placeholders:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {[
            ['{{employee_name}}', "Employee's full name"],
            ['{{date}}',          "Today's date (DD/Mon/YYYY)"],
            ['{{min_hours}}',     "Hour requirement (e.g. 5h/week)"],
            ['{{week}}',          "Pay week ending date"],
            ['{{sig_image}}',     "Your signature image URL (from profile)"],
            ['{{character_name}}', "Your character name (from profile)"],
            ['{{rank}}',          "Your current LSEMS rank"],
            ['{{bonus_table}}',   "Auto-generated rank/amount/count table rows"],
          ].map(([k, v]) => <Field key={k} name={k} desc={v} />)}
        </div>

        <div style={S.h3}>Access Control (L3 only)</div>
        <p style={S.p}>
          Fine-grained control over what each permission level can see and do. Every page and every action within
          each page is listed. For each action you set:
        </p>
        <Field name="Standard Level (L1/L2/L3)" desc="The minimum numeric level required. Any user at or above this level has access." />
        <Field name="Custom Role Chips"           desc="For any custom levels you've defined (L4 and above): · = inherits numeric, ✓ = explicitly allowed regardless of min level, ✗ = explicitly blocked regardless of level. Click a chip to cycle through states." />
        <Note type="warning">
          L3 always retains full access regardless of what is configured here. Changes take effect on the next
          page load.
        </Note>

        <div style={S.h3}>Discord Roles (L3 only)</div>
        <p style={S.p}>
          Two sub-sections:
        </p>
        <Field name="Permission Levels" desc="Define named levels. The standard levels (L1 Supervisor, L2 Command, L3 High Command) can be renamed. Add new levels with any number and name — e.g. L4 = Consultant. Level numbers are used for all access comparisons." />
        <Field name="Discord Role Mappings" desc="Map each Discord Role ID to a permission level. When a user logs in, the dashboard checks their Discord roles against this table to determine their level. Multiple roles can be mapped. The highest matching level wins." />

        <div style={S.h3}>Audit Log (L2+)</div>
        <p style={S.p}>
          A full searchable log of all actions taken through the dashboard. Every promotion, separation, LOA change,
          hours edit, payroll submission, bonus payment, and configuration change is recorded with the timestamp,
          acting user, action type, and details. The log retains the last 500 entries and is read-only.
        </p>

        <div style={S.h3}>View As</div>
        <p style={S.p}>
          The View As control (top-right of the Admin page) switches your active permission level for testing.
          When active, a banner appears in the navbar. All page rendering, button visibility, and navigation
          reflect the selected level — exactly what that user would see. Server actions still use your real
          level, so nothing is permanently affected.
        </p>
      </Card>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 32, color: 'var(--text-4)', fontSize: 11 }}>
        LSEMS Management Suite · Internal Use Only
      </div>

    </div>
  );
}
