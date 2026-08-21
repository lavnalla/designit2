import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const tutorialHelpPath = path.join(process.cwd(), 'data', 'tutorial-help.json');

function ensureTutorialHelpFile() {
  const dir = path.dirname(tutorialHelpPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(tutorialHelpPath)) {
    fs.writeFileSync(tutorialHelpPath, '[]\n', 'utf8');
  }
}

export async function GET() {
  try {
    ensureTutorialHelpFile();
    const raw = fs.readFileSync(tutorialHelpPath, 'utf8');
    const steps = JSON.parse(raw);
    return NextResponse.json({ steps });
  } catch (error) {
    console.error('Failed to read tutorial help:', error);
    return NextResponse.json({ error: 'Failed to read tutorial help' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureTutorialHelpFile();
    const body = await request.json();
    const steps = Array.isArray(body?.steps) ? body.steps : null;

    if (!steps) {
      return NextResponse.json({ error: 'Invalid tutorial steps payload' }, { status: 400 });
    }

    fs.writeFileSync(tutorialHelpPath, JSON.stringify(steps, null, 2) + '\n', 'utf8');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to save tutorial help:', error);
    return NextResponse.json({ error: 'Failed to save tutorial help' }, { status: 500 });
  }
}
