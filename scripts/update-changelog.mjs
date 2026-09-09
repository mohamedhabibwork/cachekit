import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!tag) throw new Error('Usage: node scripts/update-changelog.mjs <tag>');
if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`Expected a semantic-version tag, received "${tag}".`);

const command = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const allTags = command('tag', '--merged', tag, '--sort=-creatordate').split('\n').filter(Boolean);
const previous = allTags.find((candidate) => candidate !== tag);
const range = previous ? `${previous}..${tag}` : tag;
const changes = command('log', range, '--pretty=format:%s%x09%h').split('\n').filter(Boolean)
  .map((line) => { const [subject, sha] = line.split('\t'); return `- ${subject} (${sha})`; })
  .join('\n') || '- No user-facing changes.';
const date = new Date().toISOString().slice(0, 10);
const heading = `## [${tag}] - ${date}`;
const section = `${heading}\n\n${changes}\n`;
const header = '# Changelog\n\nAll notable changes to this project are documented in this file.\n\n';
const current = existsSync('CHANGELOG.md') ? await readFile('CHANGELOG.md', 'utf8') : header;
if (!current.includes(heading)) await writeFile('CHANGELOG.md', current.startsWith(header) ? `${header}${section}${current.slice(header.length)}` : `${header}${section}${current}`);
