import React, { Component } from 'react';
import Audio from './components/Audio';
class App extends Component {
  render() {
    return (
      <div className="App">
       <Audio audioLength={5000} />
      </div>
    );
  }
}

export default App;
