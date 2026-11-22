import { expect, test } from 'vitest';
import { clickerBinding, clickerWithProfile, parseIlumin8ClickerLink } from '../src/web/ilumin8ClickerLink';

const token = 'a1'.repeat(24);

test('shows the computer address and preserves the clicker invite', () => {
    for (const computerAddress of ['presentation.local:9443', '192.168.1.10:9443', '[fd00::10]:9443', 'presentation.local']) {
        const url = `https://${computerAddress}/remote#${token}`;
        expect(parseIlumin8ClickerLink(url)).toEqual({ computerAddress, url });
    }
});

test('rejects anything other than an exact HTTPS clicker invite', () => {
    for (const value of [
        `http://presentation.local:9443/remote#${token}`,
        `https://user@presentation.local:9443/remote#${token}`,
        `https://@presentation.local:9443/remote#${token}`,
        `https://presentation.local:9443/remote?#${token}`,
        `https://presentation.local:9443/other/../remote#${token}`,
        `https://presentation.local:9443/%72emote#${token}`,
        `https://presentation.local:9443/remote/#${token}`,
        `https://presentation.local:9443/remote#%61${token.slice(1)}`,
        `https://presentation.local:9443/remote#${token.toUpperCase()}`,
        `https://presentation.local:9443/remote#${token.slice(1)}`,
        `https://presentation.local:9443/remote#${token}\n`,
        `https://presentation.local:65536/remote#${token}`,
        `https://127.1:9443/remote#${token}`,
        `https://[1::2::3]:9443/remote#${token}`,
    ]) {
        expect(parseIlumin8ClickerLink(value)).toBeNull();
    }
});


test('preserves a verified station ID and keeps the identity ticket inside the fragment', async () => {
    const stationId = '8868b39c-63aa-45c5-9e13-497348240bdb';
    const url = 'https://presentation.local:9443/remote?stati=' + stationId + '#' + token;
    const link = parseIlumin8ClickerLink(url);
    expect(link).toEqual({ url, computerAddress: 'presentation.local:9443', stationId });
    expect(await clickerBinding(link!)).toMatch(/^[0-9a-f]{64}$/);
    const ticket = 'p'.repeat(43);
    expect(clickerWithProfile(link!, ticket)).toBe(url + '?profile=' + ticket);
    expect(parseIlumin8ClickerLink(url + '?profile=' + ticket)).toBeNull();
    expect(parseIlumin8ClickerLink(url.replace(stationId, 'untrusted'))).toBeNull();
    expect(() => clickerWithProfile(link!, ticket + '-suffix')).toThrow();
});
