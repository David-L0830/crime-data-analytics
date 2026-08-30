import logo from '../../assets/images/barangay178-logo.png';
// The RIGHT-hand seal of the printed letterhead, imported separately from the
// left-hand barangay seal so the two can differ.
//
// Every printable in the system renders this one component (Dashboard, Crime
// Data Collection, Statistical Analysis, Trends, Criminal Profile, Victim
// Profile, the incident record modal and the chart summary modal all import
// PrintReport), so swapping the right-hand seal here changes it in every
// module at once — there is no per-page letterhead to keep in step.
//
// The file is the only thing that decides which image prints; nothing about
// the header's structure, sizing or layout depends on which image it is.
// Replacing src/assets/images/caloocan-city-logo.png replaces the right-hand
// seal everywhere, with no code change.
import rightSealLogo from '../../assets/images/caloocan-city-logo.png';

// Shared A4 government-document foundation for every printable page in the
// system. Dashboard, Crime Data Collection, Statistical Analysis, Trends,
// Criminal Profile and Victim Profile all render this, and any future
// printable (certificates, clearances, incident records) should render it too
// rather than growing a second print system.
//
// Screen behaviour is unchanged: the letterhead, title block and footer are
// all .print-only (display:none off-paper), and the frame element itself is
// forced to plain block layout on screen — see .print-frame in print.css.
//
// ---------------------------------------------------------------------------
// WHY THIS RENDERS A REAL <table>, AND WHY CHILDREN GO INSIDE IT
// ---------------------------------------------------------------------------
// The official letterhead has to repeat on every printed page. A table header
// group is the only mechanism that both repeats AND reserves its own vertical
// space on each page, so flowing content can never print underneath it.
//
// Two earlier attempts were measured by rendering this markup to PDF with
// headless Chrome and counting the seal image draws per page:
//
//   divs with display: table / table-header-group
//       -> seals drawn on page 1 only. Chromium's repeat logic did not engage
//          for a CSS-generated table built out of <div>s, even after every
//          fragmentation blocker (transforms, flex ancestors, scroll
//          containers) had been removed.
//   position: fixed header + enlarged @page margins
//       -> seals on pages 1-4 of 5. Fixed elements repeat, but Chromium
//          dropped them from the LAST page, which is the one page an official
//          document can least afford to be missing its letterhead.
//   real <table> with <thead> / <tfoot>          <-- this implementation
//       -> seals on all 5 of 5 pages.
//
// A real <thead> only repeats over the rows of its OWN table, which is why the
// page content is passed as `children` and rendered inside the frame's single
// body cell rather than left as a sibling. `children` is optional: the two
// modal printables (incident record, chart summary) are single-page documents
// and still render this component self-closing.
export default function PrintReport({ title, subtitle, meta, children }) {
  const generated = new Date().toLocaleString('en-PH', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <table className="print-frame">
      <thead className="print-doc-header print-only">
        <tr>
          <td>
            <div className="print-doc-header-inner">
              {/* Two different seals now: the barangay seal on the LEFT
                  (unchanged), the city seal on the RIGHT. Both are sized the
                  same way — width in mm with height:auto and
                  object-fit:contain (see .print-doc-logo in print.css) — so
                  each keeps its OWN aspect ratio and is never cropped or
                  stretched, whatever proportions the two files happen to have.
                  The three-cell row keeps the government identification
                  optically centred between them. */}
              <div className="print-doc-header-side">
                <img
                  src={logo}
                  alt="Official Seal of Barangay 178"
                  className="print-doc-logo"
                />
              </div>
              <div className="print-doc-ident">
                <div className="print-doc-ident-line">
                  Republic of the Philippines
                </div>
                <div className="print-doc-ident-line">
                  National Capital Region
                </div>
                <div className="print-doc-ident-line">City of Caloocan</div>
                <div className="print-doc-ident-brgy">BARANGAY 178</div>
                <div className="print-doc-ident-office">
                  OFFICE OF THE PUNONG BARANGAY
                </div>
              </div>
              <div className="print-doc-header-side">
                <img
                  src={rightSealLogo}
                  alt="Official Seal of the City of Caloocan"
                  className="print-doc-logo"
                />
              </div>
            </div>
          </td>
        </tr>
      </thead>

      {/* Repeats at the foot of every page, for the same reason the header
          repeats at the top.

          NO PAGE NUMBER, and this is settled by measurement rather than
          preference: counter(pages) never resolved (Chromium implements it
          only inside @page margin boxes, which it does not support) and
          produced the original "Page 0 of 0"; counter(page) was then assumed
          to work and printed "Page 0" on every page instead. A JavaScript
          figure would be a guess, since the printable page height depends on
          the paper size, margin preset, scale and headers/footers toggle
          chosen in the print dialog, none of which the document can read. A
          wrong number on an official record is worse than none, so the footer
          carries the document identity and generation timestamp, and
          completeness is asserted by PrintDocumentEnd. */}
      <tfoot className="print-doc-footer print-only">
        <tr>
          <td>
            <div className="print-doc-footer-inner">
              <span className="print-doc-footer-left">
                Barangay 178, North Caloocan &middot; Crime Data Analytics &amp;
                Reporting System
              </span>
              <span className="print-doc-footer-right">
                Generated {generated}
              </span>
            </div>
          </td>
        </tr>
      </tfoot>

      <tbody>
        <tr>
          <td>
            {/* Flows once, at the top of page 1 — not part of the repeating
                header. */}
            <div className="print-doc-title-block print-only">
              <h1 className="print-doc-title">{title}</h1>
              {subtitle && <div className="print-doc-subtitle">{subtitle}</div>}
              {meta && meta.length > 0 && (
                <div className="print-doc-meta">
                  {meta.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
              )}
            </div>
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Reusable signature block for printed records (Criminal Profile, Victim
// Profile). Rendered as .print-only, so it never appears on screen.
//
// `signatories`: [{ role, name, title }]
//   role  - what the signature attests to ("Prepared by:", "Noted by:")
//   name  - printed in bold above the rule the person signs on; when the
//           system does not know who will sign, pass null and the line is
//           left blank rather than filled with a guess.
//   title - the designation printed under the name.
//
// The whole block carries break-inside: avoid (see print.css), which is what
// stops a signature being clipped by a page boundary — the requirement that
// motivated making this shared rather than per-page markup.
export function PrintSignatures({ signatories }) {
  if (!signatories || signatories.length === 0) return null;

  return (
    <div className="print-signatures print-only">
      <div className="print-signatures-grid">
        {signatories.map((s) => (
          <div className="print-signatory" key={s.role}>
            <div className="print-signatory-role">{s.role}</div>
            <div className="print-signatory-name">
              {/* A NON-BREAKING space, not a plain one: a plain space is
                  collapsed away and the rule the person signs on would print
                  with no height at all. */}
              {s.name || '\u00A0'}
            </div>
            {s.title && <div className="print-signatory-title">{s.title}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// End-of-document terminator for printed records and reports.
//
// This carries the completeness guarantee that a "Page X of Y" total would
// normally provide. No such total is obtainable here (see the note on the
// footer above), and "NOTHING FOLLOWS" is the standard Philippine government
// convention for the same purpose: it marks the end of the content
// unambiguously, so a reader can confirm nothing is missing from the copy in
// their hands.
export function PrintDocumentEnd() {
  return (
    <div className="print-doc-end print-only" aria-hidden="true">
      &mdash; NOTHING FOLLOWS &mdash;
    </div>
  );
}
