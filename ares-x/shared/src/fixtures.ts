import { computeSchemaHash } from './gbcr';
import { SurveySchema } from './types';

export const seedUsers = [
  { id: 'u-admin', name: 'ARES-X Admin', email: 'admin@ares.test', password: 'Admin123!', role: 'admin' },
  { id: 'u-alice', name: 'Alice Johnson', email: 'alice@ares.test', password: 'Test1234!', role: 'mobile' },
  { id: 'u-bob', name: 'Bob Smith', email: 'bob@ares.test', password: 'Secure99#', role: 'mobile' },
  { id: 'u-carol', name: 'Carol White', email: 'carol@ares.test', password: 'Pass@word1', role: 'mobile' }
];

export function buildSeedSurvey(version = 1): SurveySchema {
  const schema: SurveySchema = {
    id: 'customer-feedback',
    title: 'ARES-X Adaptive Feedback',
    description: 'Branching survey used for GBCR/RCLR verification.',
    version,
    schemaHash: '',
    questions: [
      {
        id: 'q-channel',
        type: 'single',
        title: 'Which channel did you use most recently?',
        required: true,
        stable: true,
        options: [
          { value: 'mobile', label: 'Mobile app' },
          { value: 'web', label: 'Web architect' },
          { value: 'support', label: 'Support desk' }
        ]
      },
      {
        id: 'q-mobile-rating',
        type: 'rating',
        title: 'Rate the native mobile survey flow.',
        required: true,
        stable: true,
        min: 1,
        max: 5
      },
      {
        id: 'q-mobile-pain',
        type: 'multiple',
        title: 'What should improve in the mobile flow?',
        required: false,
        stable: false,
        options: [
          { value: 'speed', label: 'Speed' },
          { value: 'clarity', label: 'Question clarity' },
          { value: 'sync', label: 'Schema sync handling' }
        ]
      },
      {
        id: 'q-web-rating',
        type: 'rating',
        title: 'Rate the Web Architect experience.',
        required: true,
        stable: true,
        min: 1,
        max: 5
      },
      {
        id: 'q-support-rating',
        type: 'rating',
        title: 'Rate your support desk experience.',
        required: true,
        stable: true,
        min: 1,
        max: 5
      },
      {
        id: 'q-support-feedback',
        type: 'text',
        title: 'Describe the support interaction.',
        required: true,
        stable: false
      },
      {
        id: 'q-low-score',
        type: 'text',
        title: 'Tell us what made the score low.',
        required: true,
        stable: false
      },
      {
        id: 'q-final',
        type: 'text',
        title: 'Any final comments before sending?',
        required: false,
        stable: true
      }
    ],
    edges: [
      { id: 'e-channel-mobile', from: 'q-channel', to: 'q-mobile-rating', predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' } },
      { id: 'e-channel-web', from: 'q-channel', to: 'q-web-rating', predicate: { kind: 'equals', questionId: 'q-channel', value: 'web' } },
      { id: 'e-channel-support', from: 'q-channel', to: 'q-support-rating', predicate: { kind: 'equals', questionId: 'q-channel', value: 'support' } },
      { id: 'e-mobile-low', from: 'q-mobile-rating', to: 'q-mobile-pain', predicate: { kind: 'rating-at-least', questionId: 'q-mobile-rating', value: 1 } },
      { id: 'e-web-low', from: 'q-web-rating', to: 'q-low-score', predicate: { kind: 'rating-at-least', questionId: 'q-web-rating', value: 1 } },
      { id: 'e-support-feedback', from: 'q-support-rating', to: 'q-support-feedback', predicate: { kind: 'rating-at-least', questionId: 'q-support-rating', value: 1 } },
      { id: 'e-mobile-final', from: 'q-mobile-rating', to: 'q-final', predicate: { kind: 'answered', questionId: 'q-mobile-rating' } },
      { id: 'e-web-final', from: 'q-low-score', to: 'q-final', predicate: { kind: 'answered', questionId: 'q-low-score' } },
      { id: 'e-support-final', from: 'q-support-feedback', to: 'q-final', predicate: { kind: 'answered', questionId: 'q-support-feedback' } }
    ]
  };
  return { ...schema, schemaHash: computeSchemaHash(schema) };
}
