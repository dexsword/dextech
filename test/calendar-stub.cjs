// Test fixture only: no Google or SMTP network requests.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  const loaded = originalLoad.call(this, request, ...args);
  if (request !== 'googleapis') return loaded;
  return { google: {
    auth: { OAuth2: class { setCredentials() {} } },
    calendar: () => ({ events: {
      list: async options => {
        if (process.env.CALENDAR_SCENARIO === 'failure') throw new Error('synthetic failure');
        const date = process.env.CALENDAR_TEST_DATE;
        const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(new Date(date + 'T12:00:00Z')).find(p => p.type === 'timeZoneName').value === 'GMT-7' ? '-07:00' : '-08:00';
        const event = {
          status: 'confirmed',
          start: { dateTime: date + 'T09:00:00' + offset },
          end: { dateTime: date + 'T09:30:00' + offset },
        };
        if (process.env.CALENDAR_SCENARIO === 'transparent') event.transparency = 'transparent';
        if (process.env.CALENDAR_SCENARIO === 'paged' && !options.pageToken) {
          return { data: { items: [], nextPageToken: 'synthetic-page-2' } };
        }
        if (process.env.CALENDAR_SCENARIO === 'all-day') {
          event.start = { date };
          const end = new Date(date + 'T00:00:00Z');
          end.setUTCDate(end.getUTCDate() + 1);
          event.end = { date: end.toISOString().slice(0, 10) };
        }
        return { data: { items: [event] } };
      },
      insert: async () => ({ data: { id: 'synthetic-event' } }),
      delete: async () => ({}),
    } }),
  } };
};
