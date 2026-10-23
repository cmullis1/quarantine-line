// Boot.
import { App } from './app.js';

const app = new App();
app.mainMenu();
window.__app = app; // for devtools and Eyes play-tests
