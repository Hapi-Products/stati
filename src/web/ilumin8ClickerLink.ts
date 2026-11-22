export interface Ilumin8ClickerLink {
    url: string;
    computerAddress: string;
    stationId?: string;
}

const clickerLink = /^https:\/\/(([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?)\/remote(?:\?stati=([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}))?#[0-9a-f]{48}$/;
const dnsName = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const ipv4Address = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;

export function parseIlumin8ClickerLink(value: string): Ilumin8ClickerLink | null {
    const match = clickerLink.exec(value);
    if (!match || match[0] !== value) return null;

    const [, computerAddress, host, port, stationId] = match;
    if (port && (+port < 1 || +port > 65535)) return null;

    try {
        const url = new URL(value);
        if (!host.startsWith('[') && (
            host.length > 253 || url.hostname !== host.toLowerCase() ||
            (!dnsName.test(host) && !ipv4Address.test(host))
        )) return null;
        return { url: value, computerAddress, ...(stationId && { stationId }) };
    } catch {
        return null;
    }
}

export async function clickerBinding(link: Ilumin8ClickerLink) {
    const code = new URL(link.url).hash.slice(1);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function clickerWithProfile(link: Ilumin8ClickerLink, ticket: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('Stați returned an invalid profile code.');
    return link.url + '?profile=' + ticket;
}
