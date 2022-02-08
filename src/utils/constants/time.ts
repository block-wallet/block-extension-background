export type Duration = number;

export const INSTANT: Duration = 0;
export const MILISECOND: Duration = INSTANT + 1;
export const SECOND: Duration = 1000 * MILISECOND;
export const MINUTE: Duration = 60 * SECOND;
export const HOUR: Duration = 60 * MINUTE;

export const currentTimestamp = () => new Date().getTime();
