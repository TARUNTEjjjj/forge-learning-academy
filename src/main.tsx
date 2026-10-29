import {Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import Forge from '../app/components/Forge';
import {BROWSER_WORKSPACE_ID} from '../lib/browser-progress';
import '../app/globals.css';
import '../app/premium.css';

class LearningBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="standalone-page"><h1>Let’s get back to learning.</h1><p>Forge could not display this screen. Your saved work has not been cleared.</p><button className="primary" onClick={()=>location.reload()}>Reload Forge</button></main>:this.props.children;}
}

createRoot(document.getElementById('root')!).render(<LearningBoundary><Forge userKey={BROWSER_WORKSPACE_ID}/></LearningBoundary>);
