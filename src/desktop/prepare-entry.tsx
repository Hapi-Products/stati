import {createRoot} from 'react-dom/client';
import {Prepare} from './prepare';
import {EditorErrorBoundary} from './EditorErrorBoundary';
createRoot(document.getElementById('root')!).render(<EditorErrorBoundary><main className="desktop-prepare"><Prepare/></main></EditorErrorBoundary>);
