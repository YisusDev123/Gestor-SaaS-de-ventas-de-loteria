import dotenv from 'dotenv';

import { loadConfig } from './src/config/environment.js';

dotenv.config({ quiet: true });

export default loadConfig(process.env);
