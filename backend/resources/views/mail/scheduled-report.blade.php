{{-- Plain-text body for an automated report (App\Mail\ScheduledReportMail).

     Every line below describes the SCOPE of the attached file. None of them
     contains a record from it — see the note on the Mailable for why that
     boundary is the point of this template rather than an accident of it. --}}
Barangay 178 Public Safety and Security
BADAC Analytics — Crime Incident Report

This report was generated automatically by CDARS (the Crime Data
Analytics and Reporting System) from the schedule "{{ $scheduleName }}",
as the output stage of the CDARS process:
Crime Data Collection -> Validation -> Analytics -> Reporting.

Report:     {{ $reportLabel }}
Scope:      {{ $scopeSummary }}
Records:    {{ $rowCount }}
Generated:  {{ $generatedAt }}

This report contains VALIDATED, OFFICIAL CDARS records only. Records
still awaiting validation, returned for correction, or archived are
never included.

The full report is attached as a CSV file.

This message was generated automatically. Please do not reply to it.
To change or stop this schedule, sign in to CDARS and open Reports.
