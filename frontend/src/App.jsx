import React, { useState } from 'react';
import axios from 'axios';
import './App.css'; 

import rdkitDict from "./rdkit_dictionary.json";

const getFeatureDetails = (rawName) => {
  if (rawName.startsWith("FP_")) {
    const bitNumber = rawName.split("_")[1];
    return {
      name: `Structural Fragment [Bit ${bitNumber}]`,
      desc: "Specific molecular sub-structure detected by the fingerprinting algorithm."
    };
  }

  if (rdkitDict && rdkitDict[rawName]) {
    let cleanName = rawName.replace(/^fr_/, ''); 
    cleanName = cleanName.replace(/([A-Z])/g, ' $1').trim(); 
    cleanName = cleanName.replace(/_/g, ' ').replace(/\s+/g, ' '); 
    cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1); 
    
    let cleanDesc = rdkitDict[rawName].desc;
    if (cleanDesc.includes("(Mol)") || cleanDesc.includes("->")) {
      cleanDesc = "Quantitative physicochemical structural descriptor.";
    }

    return {
      name: cleanName,
      desc: cleanDesc
    };
  }

  let fallbackName = rawName.replace(/^fr_/, '').replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  fallbackName = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
  
  return { 
    name: fallbackName,
    desc: "Calculated structural or physicochemical property."
  };
};

function App() {
  const [view, setView] = useState('home');
  const [smiles, setSmiles] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // --- IDENTITY STATES ---
  const [chemicalName, setChemicalName] = useState('Novel Derivative');
  const [iupacName, setIupacName] = useState('Unavailable');
  const [identityLoading, setIdentityLoading] = useState(false);

  // --- SHAP EXPLAINABILITY STATES ---
  const [shapData, setShapData] = useState(null);
  const [shapLoading, setShapLoading] = useState(false);
  const [shapError, setShapError] = useState('');

  // --- TANIMOTO SIMILARITY STATES ---
  const [simData, setSimData] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState('');

  const analyzeToxicity = async () => {
    if (!smiles) return;
    setLoading(true);
    setError('');
    
    setShapData(null); setShapLoading(false); setShapError('');
    setSimData(null); setSimLoading(false); setSimError('');
    setChemicalName('Fetching from Database...');
    setIupacName('Fetching...');
    
    try {
      const response = await axios.post('https://ck758779-toxiscan-api.hf.space/predict', { smiles });
      setResult(response.data);
      setView('results'); 
      fetchIdentityInBackground(smiles);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to connect to the API.");
    } finally {
      setLoading(false);
    }
  };

  const fetchIdentityInBackground = async (querySmiles) => {
    setIdentityLoading(true);
    try {
      const idResponse = await axios.post('https://ck758779-toxiscan-api.hf.space/identity', { smiles: querySmiles });
      setChemicalName(idResponse.data.common_name);
      setIupacName(idResponse.data.iupac_name);
    } catch (err) {
      setChemicalName("Novel Derivative");
      setIupacName("Unavailable");
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleFetchExplanation = async () => {
    setShapLoading(true); setShapError('');
    try {
      const response = await axios.post('https://ck758779-toxiscan-api.hf.space/explain', { smiles });
      setShapData(response.data.shap_explanation);
    } catch (err) {
      setShapError(err.response?.data?.detail || "Mathematical attribution mapping timed out.");
    } finally {
      setShapLoading(false);
    }
  };

  const handleFetchSimilarity = async () => {
    setSimLoading(true); setSimError('');
    try {
      const response = await axios.post('https://ck758779-toxiscan-api.hf.space/similarity', { smiles });
      setSimData(response.data.similar_compounds);
    } catch (err) {
      setSimError(err.response?.data?.detail || "Failed to query the structural database.");
    } finally {
      setSimLoading(false);
    }
  };

  const goBack = () => {
    setView('home');
    setSmiles(''); setResult(null); setError('');
    setShapData(null); setShapLoading(false); setShapError('');
    setSimData(null); setSimLoading(false); setSimError('');
  };

  const getRiskBadgeClass = (level) => {
    if (level === 'HIGH') return 'badge badge-high';
    if (level === 'MEDIUM') return 'badge badge-medium';
    return 'badge badge-low';
  };

  const formatEndpointName = (endpoint) => {
    return endpoint.replace("CYP450_", "").replace("_toxicity", "").replace("_", " ").toUpperCase();
  };

  return (
    <div className="app-container">
      {view === 'home' && (
        <main className="home-view">
          <h1 className="hero-title">ToxiScan <span>AI</span></h1>
          <p className="hero-subtitle">
           An advanced AI engine for predicting molecular safety directly from SMILES strings. Our model evaluates compounds against 12 distinct safety endpoints: Organ Toxicity (Heart, Liver, Lungs), Genotoxicity (Cancer, Mutations), Blood-Brain Barrier Penetration, Eye Irritation, and 5 key CYP450 metabolic enzymes.
          </p>
          <div className="search-box">
            <input 
              className="search-input"
              placeholder="e.g., CC(=O)OC1=CC=CC=C1C(=O)O (Aspirin)"
              value={smiles} onChange={(e) => setSmiles(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyzeToxicity()}
            />
            <button className="submit-btn" onClick={analyzeToxicity} disabled={loading}>
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>
          {error && <div className="error-message">{error}</div>}
        </main>
      )}

      {view === 'results' && result && (
        <main className="results-view">
          <button className="back-btn" onClick={goBack}>← New Analysis</button>

          <div className="dashboard-grid">
            <div className="molecule-card">
              <div className="card-header">
                <h3>Molecular Structure</h3>
                <span className={result.status === 'SAFE' ? 'badge badge-safe' : 'badge badge-hazardous'}>
                  {result.status === 'SAFE' ? 'SAFE' : 'ANALYZED'}
                </span>
              </div>
              <div className="molecule-svg-container" dangerouslySetInnerHTML={{ __html: result.molecule_svg }} />
              <div className="molecule-identity">
                <div className="identity-group">
                  <span className="identity-label">Common Name</span>
                  <span className="identity-value highlight-name" style={{ opacity: identityLoading ? 0.5 : 1 }}>
                    {chemicalName}
                  </span>
                </div>
                <div className="identity-group">
                  <span className="identity-label">IUPAC Name</span>
                  <span className="identity-value iupac-text" style={{ opacity: identityLoading ? 0.5 : 1 }}>
                    {iupacName}
                  </span>
                </div>
                <div className="identity-group">
                  <span className="identity-label">Analyzed SMILES</span>
                  <span className="identity-value smiles-text">{result.smiles}</span>
                </div>
              </div>
            </div>

            <div className="table-card">
              <div className="card-header">
                <h3>Hazard Analysis Report</h3>
                <span className="counter-text">Flags Detected: <strong>{result.flags_detected}</strong></span>
              </div>
              {result.hazards.length === 0 ? (
                <div className="safe-message">
                  <strong>{result.safety_level}</strong>
                  <p>{result.message}</p>
                </div>
              ) : (
                <div className="table-responsive-wrapper">
                  <table className="hazards-table">
                    <thead><tr><th>Endpoint</th><th>Risk Level</th><th>Confidence</th></tr></thead>
                    <tbody>
                      {result.hazards.map((hazard, index) => (
                        <tr key={index}>
                          <td data-label="Endpoint">
                            <div className="hazard-title">{hazard.title}</div>
                            <div className="hazard-desc">{hazard.description}</div>
                          </td>
                          <td data-label="Risk Level"><span className={getRiskBadgeClass(hazard.risk_level)}>{hazard.risk_level}</span></td>
                          <td data-label="Confidence" className="confidence-cell">{(hazard.confidence * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-grid mt-2">
            
            <div className="info-card col-33">
              <div className="card-header">
                <h3>Structural Attribution Analysis</h3>
                <span className="subheader-text">Marginal feature contributions (Shapley Values)</span>
              </div>

              {!shapData && !shapLoading && result.hazards.length > 0 && (
                <div className="shap-prompt-zone" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                  <p style={{ color: '#a3a3a3', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                    Inspect the specific molecular components driving these risk classifications via cooperative game theory attribution.
                  </p>
                  <button className="submit-btn" onClick={handleFetchExplanation} style={{ padding: '10px 18px', fontSize: '0.85rem' }}>
                    Deconstruct Predictions
                  </button>
                  {shapError && <div className="error-message" style={{ marginTop: '1rem' }}>{shapError}</div>}
                </div>
              )}

              {!shapData && !shapLoading && result.hazards.length === 0 && (
                <div className="shap-prompt-zone" style={{ padding: '2rem 1rem', textAlign: 'center', color: '#737373' }}>
                  <p style={{ fontSize: '0.85rem' }}>No hazard flags triggered. Structural explanation model bypassed.</p>
                </div>
              )}

              {shapLoading && (
                <div className="shap-loading-zone" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                  <div className="spinner-ring" style={{
                    display: 'inline-block', width: '30px', height: '30px',
                    border: '3px solid rgba(129, 140, 248, 0.1)', borderRadius: '50%',
                    borderTopColor: '#818cf8', animation: 'spin 0.8s linear infinite'
                  }}></div>
                  <h4 style={{ margin: '1.2rem 0 0.4rem', color: '#818cf8', fontSize: '0.9rem' }}>Running Game Logic...</h4>
                </div>
              )}

              {shapData && shapData.length > 0 && (
                <div className="shap-scroll-container">
                  {shapData.map((group, idx) => (
                    <div key={idx} className="shap-group-block">
                      <h4 className="shap-endpoint-title">{formatEndpointName(group.endpoint)}</h4>
                      <div className="shap-items-wrapper">
                        {group.top_drivers.map((driver, dIdx) => {
                          const barWidth = Math.min(Math.abs(driver.contribution) * 200, 100);
                          const isRiskUp = driver.direction === 'up';
                          const featureInfo = getFeatureDetails(driver.feature);

                          return (
                            <div className="shap-row-item" key={dIdx}>
                              <div className="shap-meta-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                  <span className="shap-feature-name" style={{ wordBreak: 'break-word', lineHeight: '1.2' }}>{featureInfo.name}</span>
                                  <span style={{ fontSize: '0.7rem', color: '#737373', marginTop: '4px', lineHeight: '1.3' }}>{featureInfo.desc}</span>
                                </div>
                                <span className={`shap-value-badge ${isRiskUp ? 'text-up' : 'text-down'}`} style={{ whiteSpace: 'nowrap', marginTop: '2px', flexShrink: 0 }}>
                                    {driver.contribution > 0 ? `+${driver.contribution.toFixed(4)}` : driver.contribution.toFixed(4)}
                                </span>
                              </div>
                              <div className="shap-bar-track" style={{ marginTop: '6px' }}>
                                <div className={`shap-bar-fill ${isRiskUp ? 'bg-up' : 'bg-down'}`} style={{ width: `${barWidth}%` }} />
                              </div>
                              <div className="shap-direction-label">{isRiskUp ? '↑ Elevates Risk' : '↓ Reduces Risk'}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="info-card col-67">
              <div className="card-header">
                <h3>Known Structural Matches</h3>
                <span className="subheader-text">Tanimoto Database Search matches</span>
              </div>

              {!simData && !simLoading && (
                <div className="shap-prompt-zone" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                  <p style={{ color: '#a3a3a3', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                    Cross-reference this compound against historical toxicity databases to find the closest structural matches.
                  </p>
                  <button className="submit-btn" onClick={handleFetchSimilarity} style={{ padding: '10px 18px', fontSize: '0.85rem' }}>
                    Run Similarity Search
                  </button>
                  {simError && <div className="error-message" style={{ marginTop: '1rem' }}>{simError}</div>}
                </div>
              )}

              {simLoading && (
                <div className="shap-loading-zone" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                  <div className="spinner-ring" style={{
                    display: 'inline-block', width: '30px', height: '30px',
                    border: '3px solid rgba(129, 140, 248, 0.1)', borderRadius: '50%',
                    borderTopColor: '#818cf8', animation: 'spin 0.8s linear infinite'
                  }}></div>
                  <h4 style={{ margin: '1.2rem 0 0.4rem', color: '#818cf8', fontSize: '0.9rem' }}>Querying Memory DB...</h4>
                </div>
              )}

              {simData && simData.length > 0 && (
                <div className="similar-scroll-container">
                  {simData.map((cmp, idx) => (
                    <div className="similar-item-card" key={idx}>
                      <div className="similar-card-row">
                        <span className="similar-smiles-string" title={cmp.smiles}>{cmp.smiles}</span>
                        <span className="similarity-percentage">{(cmp.similarity_score * 100).toFixed(1)}% Match</span>
                      </div>
                      <div className="similar-tags-flex">
                        {cmp.known_hazards.length === 0 ? (
                          <span className="badge-safe-outline">SAFE COMPOUND</span>
                        ) : (
                          cmp.known_hazards.map((h, i) => (
                            <span key={i} className="badge-hazard-pill">
                              {h.replace("CYP450_", "").replace("_toxicity", "").replace("_", " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {simData && simData.length === 0 && (
                <div className="safe-message" style={{ padding: '2rem 1rem', textAlign: 'center', color: '#737373' }}>
                  <p style={{ fontSize: '0.85rem' }}>No tracking records available for comparative structural screening.</p>
                </div>
              )}
            </div>

          </div>
        </main>
      )}
    </div>
  );
}

export default App;