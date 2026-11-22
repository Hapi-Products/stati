import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { clickerBinding, clickerWithProfile, parseIlumin8ClickerLink, type Ilumin8ClickerLink } from './ilumin8ClickerLink';

import { post } from './api';

export function Scanner() {
    const [open, setOpen] = useState(false);
    const [error, setError] = useState('');
    const [link, setLink] = useState('');
    const [sharing, setSharing] = useState(false);
    const [clicker, setClicker] = useState<Ilumin8ClickerLink | null>(null);
    const video = useRef<HTMLVideoElement>(null);

    function follow(value: string) {
        const clickerLink = parseIlumin8ClickerLink(value);
        if (clickerLink) {
            setOpen(false);
            setError('');
            setLink('');
            setClicker(clickerLink);
            return;
        }

        try {
            const trimmed = value.trim();
            const url = new URL(/^[\w-]{8,100}$/.test(trimmed) ? '/send/' + trimmed : trimmed, location.origin);
            if (url.origin !== location.origin || !/^\/(send|pair)\/[\w-]+$/.test(url.pathname) || url.search || url.hash) throw new Error();
            location.assign(url.href);
        } catch {
            setError('Use a Stați receiver or pairing QR, or scan an Ilumin8 clicker QR.');
        }
    }

    async function shareProfile(link: Ilumin8ClickerLink) {
        if (!link.stationId || sharing) return;
        setError('');
        setSharing(true);
        try {
            const { ticket } = await post<{ ticket: string }>('/ilumin8/participant-ticket', {
                stationId: link.stationId, binding: await clickerBinding(link)
            });
            const anchor = document.createElement('a');
            anchor.href = clickerWithProfile(link, ticket);
            anchor.rel = 'noreferrer';
            anchor.click();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Stați could not verify your profile. Try scanning again.');
        } finally {
            setSharing(false);
        }
    }

    useEffect(() => {
        if (!open || !video.current) return;
        let stopped = false;
        let controls: IScannerControls | undefined;
        const reader = new BrowserQRCodeReader();
        void reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, result => {
            if (!result || stopped) return;
            stopped = true;
            controls?.stop();
            setOpen(false);
            follow(result.getText());
        }).then(value => {
            controls = value;
            if (stopped) value.stop();
        }).catch(() => {
            if (stopped) return;
            setOpen(false);
            setError('Camera unavailable. Allow camera access in your browser settings, or paste the code or link below.');
        });
        return () => {
            stopped = true;
            controls?.stop();
        };
    }, [open]);

    return <section className="card">
        <h2>Connect with a code</h2>
        {clicker ? <div aria-live="polite">
            <h3>Open Ilumin8 clicker?</h3>
            <p><strong>{clicker.computerAddress}</strong></p>
            <p>Continue if you recognize this computer, then approve this phone in Ilumin8.</p>
            {clicker.stationId && <p>Open with Stați to share your first name and profile photo with this operator.</p>}
            <div className="actions">
                {clicker.stationId
                    ? <button className="button primary" type="button" disabled={sharing} onClick={() => void shareProfile(clicker)}>{sharing ? 'Connecting…' : 'Open with Stați'}</button>
                    : <a className="button primary" href={clicker.url} target="_blank" rel="noreferrer">Open in browser</a>}
                <button type="button" className="button" disabled={sharing} onClick={() => { setClicker(null); setError(''); }}>Cancel</button>
            </div>
        </div> : <>
            <button className="button primary" onClick={() => { setError(''); setOpen(!open); }}>{open ? 'Stop camera' : 'Scan QR code'}</button>
            {open && <video ref={video} autoPlay muted playsInline style={{ width: '100%', maxHeight: 320 }} />}
            <p>Paste the code after /send/ in the computer’s link, or scan an Ilumin8 clicker QR.</p>
            <form onSubmit={event => { event.preventDefault(); follow(link.trim()); }}>
                <input aria-label="Receiver code or Ilumin8 link" placeholder="Paste code or link" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={link} onChange={event => setLink(event.target.value)} />
                <button className="button">Connect</button>
            </form>
        </>}
        {error && <p role="alert">{error}</p>}
    </section>;
}
