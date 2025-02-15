import React, { useState, useEffect, useRef } from 'react';

// indexdb credentials
const DB_NAME = "AudioRMSDatabase";
const STORE_NAME = "rmsValues";
const DB_VERSION = 1;

// fetch the latest amplitude value from indexdb
const fetchLastAmplitude = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const cursorRequest = store.openCursor(null, "prev");

      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          resolve(cursor.value.rms);
        } else {
          resolve(null);
        }
      };
      cursorRequest.onerror = (event) => reject(event.target.error);
    };
    request.onerror = (event) => reject(event.target.error);
  });
};

function Audio({ audioLength }) {
  const [amplitudeFromIndexdb, setAmplitudeFromIndexdb] = useState(null); // fetch the latest amplitude value from index db
  const [rmsValue, setRmsValue] = useState(null); // hold the rms amplitude value from indexdb
  const [realTimeAmplitude, setRealTimeAmplitude] = useState('N/A'); // for storing real time audio amplitude value of audio
  const amplitudeIntervalRef = useRef(null); // variable to hold the real time amplitude value of each second
  const audioStreamRef = useRef(null); // from web audio api 
  const [isBothDisabled, setIsBothDisabled] = useState(true); // variable that handles logics for enabling and disabling recording buttons
  const [isCapturing, setIsCapturing] = useState(false); // state variable that check if real time recording is performing or not
  const [isRecording, setIsRecording] = useState(false); // condition to check of environment sound recording
  const mediaRecorderRef = useRef(null); // from web audio api 
  const audioChunksRef = useRef([]); // from web audio api 
  const [timeLeft, setTimeLeft] = useState(audioLength/1000); // Starting from 10 seconds
  const [popUp, setPopUp] = useState(""); // displaying the warning content
  const [LowerRange, setLowerRange] = useState(0.0) // store lower range amplitude value
  const [HigherRange, setHigherRange] = useState(0.0) // store higher range amplitude value
  const [lastPopUpTime, setLastPopUpTime] = useState(0); // track the last time the popup was shown
  const [showingPopup, setShowingPopup] = useState(false); // conditional logic to display popup

  useEffect(() => {
    fetchAmplitude();
  }, []); // Runs only once when component render

  const fetchAmplitude = async () => {
    try {
      const data = await fetchLastAmplitude();
      setAmplitudeFromIndexdb(data !== null ? data : "No Data");
    } catch (error) {
      console.error("Error fetching amplitude:", error);
    }
  };

  useEffect(() => {
    if(amplitudeFromIndexdb === "No Data") {
      setIsBothDisabled(true)
      startRecording();
    } else {
      setIsBothDisabled(false)
      setRmsValue(amplitudeFromIndexdb);
    }
  }, [amplitudeFromIndexdb]);


  useEffect(() => {
    if (isRecording) {
      const timer = setTimeout(() => {
        stopRecording();
      }, audioLength); // Automatically stop recording after 10 seconds

      return () => clearTimeout(timer); // Cleanup when recording stops
    }
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setTimeLeft(audioLength/1000);
      const countdownInterval = setInterval(() => {
        setTimeLeft(prevTime => {
          if (prevTime <= 1) {
            clearInterval(countdownInterval); // Stop the countdown when it reaches 0
            stopRecording();
            setIsBothDisabled(false)
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }

        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
          // Calculate RMS for the first 10 seconds and store it in IndexedDB
          await calculateRms(audioBlob);
        }
      };

      mediaRecorder.onstop = () => {
        setIsRecording(false);
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };


  const calculateRms = async (audioBlob) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());

    // Get the first 10 seconds of audio
    const duration = Math.min(10, audioBuffer.duration);
    const audioData = audioBuffer.getChannelData(0); // Assuming mono audio with first channel

    // Calculate RMS
    const sampleCount = Math.floor(duration * audioBuffer.sampleRate);
    let sumOfSquares = 0;

    for (let i = 0; i < sampleCount; i++) {
      sumOfSquares += audioData[i] ** 2;
    }

    const rms = Math.sqrt(sumOfSquares / sampleCount);
    setRmsValue(rms.toFixed(9));

    // Store RMS value in IndexedDB
    storeRmsInIndexedDB(rms.toFixed(9));
  };


  const storeRmsInIndexedDB = (rmsValue) => {
    const dbRequest = indexedDB.open(DB_NAME, DB_VERSION);
    dbRequest.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };

    dbRequest.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const newRmsValue = { rms: rmsValue, timestamp: new Date() };
      store.add(newRmsValue);
    };

    dbRequest.onerror = (e) => {
      console.error("Error opening IndexedDB:", e.target.error);
    };
  };


  const handleAmplitudeUpdate = async (meanAmplitude) => {
    setRealTimeAmplitude(meanAmplitude);
    let meanStr = meanAmplitude.toString();
    let decimalPart = meanStr.includes('.') ? meanStr.split('.')[1] : '';
    // Find the position of the first non-zero digit in the decimal part
    let firstNonZeroIndex = decimalPart.search(/[1-9]/);
    // Calculate the dynamic adjustment factor
    let adjustmentFactor = firstNonZeroIndex !== -1
      ? parseFloat('0.' + '0'.repeat(firstNonZeroIndex) + '09')
      : 0.000000001;
    if (rmsValue !== null) {
      let meanAmplitudeNum = parseFloat(rmsValue);
      let meanAmplitudeRange = [
        (meanAmplitudeNum - adjustmentFactor) > 0.05
          ? (meanAmplitudeNum - adjustmentFactor)
          : (adjustmentFactor),
        (meanAmplitudeNum + adjustmentFactor) > 0.05
          ? (meanAmplitudeNum + adjustmentFactor)
          : (meanAmplitudeNum + (adjustmentFactor * 50))
      ];
      setLowerRange(meanAmplitudeRange[0])
      setHigherRange(meanAmplitudeRange[1])
    }
  };

  const startCapturingAmplitude = () => {
    if (audioStreamRef.current) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("Audio input not supported in this browser.");
      return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        audioStreamRef.current = stream;
        const microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        const calculateAmplitude = () => {
          analyser.getFloatTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += Math.abs(dataArray[i]);
          }
          const meanAmplitude = sum / bufferLength;
          handleAmplitudeUpdate(meanAmplitude.toFixed(9));
        };

        amplitudeIntervalRef.current = setInterval(calculateAmplitude, 1000); // calculate amplitude for each 1s interval
        setIsCapturing(true);
      })
      .catch(error => {
        console.error("Error accessing microphone: ", error);
      });

  };

  const stopCapturingAmplitude = () => {
    setRealTimeAmplitude('N/A')
    if (amplitudeIntervalRef.current) {
      clearInterval(amplitudeIntervalRef.current);
      amplitudeIntervalRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    setIsCapturing(false);
  };

  useEffect(() => {
    if (isCapturing) {
      if (realTimeAmplitude > HigherRange && !showingPopup) {
        setPopUp("Larger Noise");
        setShowingPopup(true);
        setLastPopUpTime(Date.now()); // Set the time when popup is shown
        setTimeout(() => {
          setPopUp("");
          setShowingPopup(false);
        }, 2000); // Popup is shown for 2 seconds
      } else if (realTimeAmplitude < LowerRange && realTimeAmplitude !== 0 && !showingPopup) {
        setPopUp("Smaller Noise");
        setShowingPopup(true);
        setLastPopUpTime(Date.now());
        setTimeout(() => {
          setPopUp("");
          setShowingPopup(false);
        }, 2000);
      } else if (realTimeAmplitude === 0 && !showingPopup) {
        setPopUp("No Sound Detected");
        setShowingPopup(true);
        setLastPopUpTime(Date.now());
        setTimeout(() => {
          setPopUp("");
          setShowingPopup(false);
        }, 2000);
      }
    }

    // Display popup for at least 5 sec interval
    if (showingPopup === false && Date.now() - lastPopUpTime >= 5000) {
      setShowingPopup(false);
    }
  }, [realTimeAmplitude, isCapturing, lastPopUpTime, showingPopup]);


  return (
    <div className="App">
      <div>
        {isRecording ? <p>Recording... {timeLeft}s</p> : ""}
        {/* {rmsValue !== null && <p>RMS Value (First 10 seconds): {rmsValue}</p>} */}
      </div>
      <button onClick={startCapturingAmplitude} disabled={isBothDisabled || isCapturing}>
        Start Recording
      </button>
      <button onClick={stopCapturingAmplitude} disabled={isBothDisabled || !isCapturing}>
        Stop Recording
      </button>
      <br />
      {/* {isCapturing && (
        <span id="amplitudeValueReal">Real Time Mean Amplitude: {realTimeAmplitude}</span>
      )} */}
      <p>{popUp}</p>
    </div>
  );
}

export default Audio;