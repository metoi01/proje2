import fs from 'node:fs';
import path from 'node:path';
import { buildSeedSurvey, seedUsers, SurveySchema, SurveySession } from '../../shared/src';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
}

interface DatabaseShape {
  users: UserRecord[];
  surveys: SurveySchema[];
  history: Record<string, SurveySchema[]>;
  sessions: SurveySession[];
}

export class JsonStore {
  constructor(private readonly filePath: string) {
    this.ensure();
  }

  reset() {
    const seed = buildSeedSurvey(1);
    this.write({
      users: seedUsers,
      surveys: [seed],
      history: { [seed.id]: [seed] },
      sessions: []
    });
  }

  read(): DatabaseShape {
    this.ensure();
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as DatabaseShape;
  }

  write(db: DatabaseShape) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  }

  update(mutator: (db: DatabaseShape) => void): DatabaseShape {
    const db = this.read();
    mutator(db);
    this.write(db);
    return db;
  }

  private ensure() {
    if (!fs.existsSync(this.filePath)) this.reset();
  }
}

export function defaultStorePath() {
  return path.resolve(process.cwd(), 'backend/data/db.json');
}
