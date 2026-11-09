/**
 * In-app help and "What's new" (Sprint 9). Plain staff words, one short
 * answer per task with a link to the screen. Kept in code so it ships with
 * the release it describes; the support manual has the long version.
 */

export interface HelpTopic {
  id: string;
  title: string;
  steps: string[];
  href?: string;
  linkText?: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  { id: 'register', title: 'Register a patient', steps: ['Press + New patient (top of the menu).', 'Mobile and name are enough; add sex and age if you know them.', 'If someone with that mobile exists, Chairside asks before adding another (families share phones).'], href: '/patients/new', linkText: 'New patient' },
  { id: 'bill', title: 'Make a bill', steps: ['Open the patient, press New bill.', 'Type a few letters of the treatment and press Enter; add tooth, quantity or a discount with a reason.', 'Press Issue bill. A bill can’t be edited once issued: cancel it and make a new one.'], href: '/patients', linkText: 'Find a patient' },
  { id: 'payment', title: 'Take a payment', steps: ['Open the patient, press Record payment.', 'Enter the amount and how they paid. Chairside settles the oldest bill first and tells you how.', 'Paid two ways (cash and UPI)? Press “Paid more than one way” and enter each part.'] },
  { id: 'appointments', title: 'Book, move or cancel an appointment', steps: ['From the patient: Book appointment. Or tap a free time on Appointments.', 'Move and Cancel are on each appointment. Two people can’t be booked with one doctor at the same time.', 'A doctor away? Appointments → Doctor leave blocks those days and lists bookings to move.'], href: '/appointments', linkText: 'Appointments' },
  { id: 'reminders', title: 'Reminders and Today’s messages', steps: ['The owner sets when reminders go and what they say in Settings → Reminders (or adds the suggested set).', 'The desk opens Messages, taps Send on each one; WhatsApp opens with the message ready from the clinic’s phone.', 'If a patient replies STOP, press “Patient said STOP” on their page. No reminders go in quiet hours.'], href: '/messages', linkText: 'Today’s messages' },
  { id: 'dayclose', title: 'Close the day', steps: ['At the end of the day open Day close.', 'Count the cash drawer and enter it; Chairside shows any difference.', 'Close. The owner can reopen a closed day if something was missed.'], href: '/day-close', linkText: 'Day close' },
  { id: 'import', title: 'Bring your data from other software', steps: ['Export patients (and coming appointments) to Excel or CSV in your old software.', 'Settings → Bring your data: paste or pick the file, press Check, look over the rows, press Import.', 'Patients first, then appointments: appointments find patients by mobile.', 'Import when the desk is quiet (before opening or after closing): a large import pauses new registrations at that branch for a few seconds.'], href: '/settings/import', linkText: 'Bring your data' },
  { id: 'signin', title: 'Can’t sign in', steps: ['Use “Forgot password?” on the sign-in page if it’s there.', 'Otherwise ask the owner: Settings → Team → New link, and open the link to choose a new password.', 'Chairside never asks for your password by phone or WhatsApp.'] },
];

export interface ReleaseNote {
  id: string;
  date: string;
  items: string[];
}

/** Newest first. */
export const WHATS_NEW: ReleaseNote[] = [
  {
    id: '2026-11-s9',
    date: '2026-11-10',
    items: [
      'Bring your data: import patients and coming appointments from Excel or CSV, with a dry run first.',
      'Split payment: part cash, part UPI in one go.',
      'This help page.',
    ],
  },
  {
    id: '2026-11-s8',
    date: '2026-11-10',
    items: [
      'Reminders your way: choose when patients get WhatsApp reminders and write the wording (Settings → Reminders); the desk sends them from Messages.',
      'Doctor leave: block days off and see which bookings to move.',
      'Discount limits per role (Settings → Clinic).',
      'Each treatment can have its appointment length and a come-back gap; come-back gaps are a clinic setting.',
      '“₹ due” beside patients on Appointments and in the waiting room.',
    ],
  },
  {
    id: '2026-11-s7',
    date: '2026-11-09',
    items: ['Add a branch yourself (Settings → Branches).', 'Turn off the parallel-run parts once you stop using the old software (Settings → Clinic).', 'Getting started checklist for new clinics.'],
  },
];
