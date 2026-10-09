import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { defaultProject, validateProject } from '../shared/music.js';

export function createProjectStore(dataDir) {
  const projectPath = path.join(dataDir, 'project.json');
  let saveQueue = Promise.resolve();

  async function load() {
    try {
      const content = await readFile(projectPath, 'utf8');
      return { project: validateProject(JSON.parse(content)), restored: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { project: defaultProject(), restored: false };
      throw error;
    }
  }

  function save(project) {
    // The API validates first. Serialize explicit saves and replace the file atomically.
    const result = saveQueue.then(async () => {
      const temporary = `${projectPath}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(project, null, 2));
      await rename(temporary, projectPath);
    });
    saveQueue = result.catch(() => {});
    return result;
  }

  return { load, save };
}
