// One immutable level per server process. The server serves its chosen ID to browsers.
const requestedLevel = typeof process !== 'undefined' ? process.env?.DEADWOOD_LEVEL : undefined;
export const LEVEL_ID = requestedLevel === 'supermarket' || requestedLevel === 'hospital' || requestedLevel === 'funfair' ? requestedLevel : 'cabin';
