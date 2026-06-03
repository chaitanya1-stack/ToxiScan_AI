import React, { useState } from 'react';
import axios from 'axios';
import './App.css'; 

import rdkitDict from "./rdkit_dictionary.json";

// --- THE AUTOMATED TRANSLATOR ---
const getFeatureDetails = (rawName) => {
  if (rawName.startsWith("FP_")) {
    const bitNumber = rawName.split("_")[1];
    return {
      name: `Structural Fragment [Bit ${bitNumber}]`,
      desc: "A specific circular sub-structure of atoms and bonds detected by the algorithm."
    };
  }

  if (rdkitDict && rdkitDict[rawName]) {
    let cleanName = rawName.replace(/^fr_/, ''); 
    cleanName = cleanName.replace(/([A-Z])/g, ' $1').trim(); 
    cleanName = cleanName.replace(/_/g, ' ').replace(/\s+/g, ' '); 
    cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1); 
    
    return {
      name: cleanName,
      desc: rdkitDict[rawName].desc
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

  const analyzeToxicity = async () => {
    if (!smiles) return;
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post('https://ck758779-toxiscan-api.hf.space/predict', { smiles });
      setResult(response.data);
      setView('results'); 
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to connect to the API.");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setView('home');
    setSmiles('');
    setResult(null);
    setError('');
  };

  const getRiskBadgeClass = (level) => {
    if (level === 'HIGH') return 'badge badge-high';
    if (level === 'MEDIUM') return 'badge badge-medium';
    return 'badge badge-low';
  };

  const formatEndpointName = (endpoint) => {
    return endpoint
      .replace("CYP450_", "")
      .replace("_toxicity", "")
      .replace("_", " ")
      .toUpperCase();
  };

  return (
    <div className="app-container">
      
      {/* ----------------- LANDING PAGE ----------------- */}
      {view === 'home' && (
        <main className="home-view">
          <h1 className="hero-title">
            ToxiScan <span>AI</span>
          </h1>
          <p className="hero-subtitle">
            An advanced AI engine for predicting molecular safety directly from SMILES strings. Our model evaluates compounds against 12 distinct safety endpoints: Organ Toxicity (Heart, Liver, Lungs), Genotoxicity (Cancer, Mutations), Blood-Brain Barrier Penetration, Eye Irritation, and 5 key CYP450 metabolic enzymes.
          </p>

          <div className="search-box">
            <input 
              className="search-input"
              placeholder="e.g., CC(=O)OC1=CC=CC=C1C(=O)O (Aspirin)"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyzeToxicity()}
            />
            <button 
              className="submit-btn" 
              onClick={analyzeToxicity} 
              disabled={loading}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>
          
          {error && <div className="error-message">{error}</div>}
        </main>
      )}

      {/* ----------------- RESULTS PAGE ----------------- */}
      {view === 'results' && result && (
        <main className="results-view">
          <button className="back-btn" onClick={goBack}>
            ← New Analysis
          </button>

          {/* TOP ROW: Structure & Hazards */}
          <div className="dashboard-grid">
            
            {/* Left: Molecule SVG and Identity */}
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
                  <span className="identity-value highlight-name">
                    {result.common_name || "Novel Derivative"}
                  </span>
                </div>
                <div className="identity-group">
                  <span className="identity-label">IUPAC Name</span>
                  <span className="identity-value iupac-text">
                    {result.iupac_name || "Unavailable"}
                  </span>
                </div>
                <div className="identity-group">
                  <span className="identity-label">Analyzed SMILES</span>
                  <span className="identity-value smiles-text">
                    {result.smiles}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Hazard Data Table */}
            <div className="table-card">
              <div className="card-header">
                <h3>Hazard Analysis Report</h3>
                <span className="counter-text">
                  Flags Detected: <strong>{result.flags_detected}</strong>
                </span>
              </div>

              {result.hazards.length === 0 ? (
                <div className="safe-message">
                  <strong>{result.safety_level}</strong>
                  <p>{result.message}</p>
                </div>
              ) : (
                <div className="table-responsive-wrapper">
                  <table className="hazards-table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th>Risk Level</th>
                        <th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.hazards.map((hazard, index) => (
                        <tr key={index}>
                          <td data-label="Endpoint">
                            <div className="hazard-title">{hazard.title}</div>
                            <div className="hazard-desc">{hazard.description}</div>
                          </td>
                          <td data-label="Risk Level">
                            <span className={getRiskBadgeClass(hazard.risk_level)}>
                              {hazard.risk_level}
                            </span>
                          </td>
                          <td data-label="Confidence" className="confidence-cell">
                            {(hazard.confidence * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM ROW: Explainability & Similarity */}
          {(result.shap_explanation?.length > 0 || result.similar_compounds?.length > 0) && (
            <div className="dashboard-grid mt-2">
              
              {/* Left: SHAP Explainability */}
              {result.shap_explanation && result.shap_explanation.length > 0 && (
                <div className="info-card col-33">
                  <div className="card-header">
                    <h3>AI Brain: Decision Drivers</h3>
                    <span className="subheader-text">Top structural factors </span>
                  </div>
                  <div className="shap-scroll-container">
                    {result.shap_explanation.map((group, idx) => (
                      <div key={idx} className="shap-group-block">
                        <h4 className="shap-endpoint-title">
                          {formatEndpointName(group.endpoint)} RISK FACTORS
                        </h4>
                        
                        <div className="shap-items-wrapper">
                          {group.top_drivers.map((driver, dIdx) => {
                            const barWidth = Math.min(Math.abs(driver.contribution) * 200, 100);
                            const isRiskUp = driver.direction === 'up';
                            const featureInfo = getFeatureDetails(driver.feature);

                            return (
                              <div className="shap-row-item" key={dIdx}>
                                
                                {/* Bulletproof Flexbox Wrap */}
                                <div className="shap-meta-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                    <span className="shap-feature-name" style={{ wordBreak: 'break-word', lineHeight: '1.2' }}>
                                      {featureInfo.name}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: '#737373', marginTop: '4px', lineHeight: '1.3' }}>
                                      {featureInfo.desc}
                                    </span>
                                  </div>
                                  
                                  {/* Locked width for the number badge so it never squishes */}
                                  <span className={`shap-value-badge ${isRiskUp ? 'text-up' : 'text-down'}`} style={{ whiteSpace: 'nowrap', marginTop: '2px', flexShrink: 0 }}>
                                    {driver.contribution > 0 ? `+${driver.contribution.toFixed(4)}` : driver.contribution.toFixed(4)}
                                  </span>
                                </div>
                                
                                <div className="shap-bar-track" style={{ marginTop: '8px' }}>
                                  <div 
                                    className={`shap-bar-fill ${isRiskUp ? 'bg-up' : 'bg-down'}`}
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                                <div className="shap-direction-label">
                                  {isRiskUp ? '↑ Increases Risk Probability' : '↓ Decreases Risk Probability'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Right: Tanimoto Similarity */}
              {result.similar_compounds && result.similar_compounds.length > 0 && (
                <div className="info-card col-67">
                  <div className="card-header">
                    <h3>Known Structural Matches</h3>
                    <span className="subheader-text">Tanimoto Database Search matches</span>
                  </div>
                  <div className="similar-scroll-container">
                    {result.similar_compounds.map((cmp, idx) => (
                      <div className="similar-item-card" key={idx}>
                        <div className="similar-card-row">
                          <span className="similar-smiles-string" title={cmp.smiles}>{cmp.smiles}</span>
                          <span className="similarity-percentage">{(cmp.similarity_score * 100).toFixed(1)}% Match</span>
                        </div>
                        <div className="similar-tags-flex">
                          {cmp.known_hazards.length === 0 ? (
                            <span className="badge badge-safe-outline">SAFE COMPOUND</span>
                          ) : (
                            cmp.known_hazards.map((h, i) => (
                              <span key={i} className="badge badge-hazard-pill">
                                {h.replace("CYP450_", "").replace("_toxicity", "").replace("_", " ")}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

        </main>
      )}
    </div>
  );
}

export default App;
