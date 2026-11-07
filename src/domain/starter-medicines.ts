/**
 * A starting medicine list for a dental clinic (Sprint 5, LET-172), added only
 * when the owner presses "Add common dental medicines". Usual adult defaults
 * as a convenience; the doctor checks and edits every one before relying on it.
 * Not clinical advice. No controlled (Schedule X / narcotic) drugs.
 */
import type { MedicineInput } from './rx';

type M = Omit<MedicineInput, 'days'> & { days: string };
const m = (name: string, strength: string, form: string, dose: string, frequency: string, days: string, instructions: string): M => ({ name, strength, form, dose, frequency, days, instructions });

export const STARTER_MEDICINES: M[] = [
  m('Amoxicillin', '500 mg', 'capsule', '1 capsule', '1-1-1', '5', 'After food'),
  m('Amoxicillin + Clavulanic acid', '625 mg', 'tablet', '1 tablet', '1-0-1', '5', 'After food'),
  m('Azithromycin', '500 mg', 'tablet', '1 tablet', '1-0-0', '3', 'An hour before food'),
  m('Cefixime', '200 mg', 'tablet', '1 tablet', '1-0-1', '5', 'After food'),
  m('Clindamycin', '300 mg', 'capsule', '1 capsule', '1-1-1', '5', 'After food'),
  m('Metronidazole', '400 mg', 'tablet', '1 tablet', '1-1-1', '5', 'After food; no alcohol'),
  m('Ornidazole', '500 mg', 'tablet', '1 tablet', '1-0-1', '5', 'After food; no alcohol'),
  m('Doxycycline', '100 mg', 'capsule', '1 capsule', '1-0-1', '5', 'After food, with water'),
  m('Ibuprofen', '400 mg', 'tablet', '1 tablet', '1-0-1', '3', 'After food'),
  m('Paracetamol', '650 mg', 'tablet', '1 tablet', '1-1-1', '3', 'After food'),
  m('Aceclofenac + Paracetamol', '100/325 mg', 'tablet', '1 tablet', '1-0-1', '3', 'After food'),
  m('Diclofenac', '50 mg', 'tablet', '1 tablet', '1-0-1', '3', 'After food'),
  m('Ketorolac', '10 mg', 'tablet', '1 tablet', 'SOS', '', 'For pain; at most 3 a day'),
  m('Etoricoxib', '90 mg', 'tablet', '1 tablet', '1-0-0', '3', 'After food'),
  m('Serratiopeptidase', '10 mg', 'tablet', '1 tablet', '1-0-1', '5', 'After food'),
  m('Pantoprazole', '40 mg', 'tablet', '1 tablet', '1-0-0', '5', 'Before breakfast'),
  m('Tranexamic acid', '500 mg', 'tablet', '1 tablet', '1-1-1', '2', 'After food'),
  m('Vitamin B complex', '', 'tablet', '1 tablet', '1-0-0', '15', 'After food'),
  m('Chlorhexidine', '0.2%', 'mouthwash', '10 ml', '1-0-1', '7', 'Rinse 1 minute; don’t swallow; no food for 30 minutes'),
  m('Povidone iodine gargle', '2%', 'mouthwash', '10 ml', '1-0-1', '5', 'Dilute with equal water; gargle and spit'),
  m('Benzydamine', '0.15%', 'mouthwash', '15 ml', '1-1-1', '5', 'Rinse and spit'),
  m('Lignocaine', '2%', 'gel', 'Apply thin layer', '', '', 'Apply on the sore area before food'),
  m('Triamcinolone', '0.1%', 'paste', 'Apply thin layer', '0-0-1', '5', 'Apply on ulcer at night'),
  m('Choline salicylate + Benzalkonium', '', 'gel', 'Apply', '1-1-1', '5', 'Apply on ulcer'),
  m('Clotrimazole', '1%', 'drops', 'Apply', '1-1-1', '7', 'Mouth paint'),
  m('Potassium nitrate toothpaste', '5%', 'toothpaste', 'Pea-sized', '1-0-1', '30', 'Brush gently; don’t rinse right away'),
  m('Fluoride toothpaste', '1000 ppm', 'toothpaste', 'Pea-sized', '1-0-1', '', 'Brush twice a day'),
  m('Chlorhexidine gel', '1%', 'gel', 'Apply', '1-0-1', '7', 'Massage on gums'),
];
