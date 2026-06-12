from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import pandas as pd
import tensorflow as tf
import joblib
import json
import urllib.parse
import os
import gc
from rdkit import Chem
from rdkit.Chem import Descriptors, AllChem
from rdkit.Chem.rdFingerprintGenerator import GetMorganGenerator
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Chem import FilterCatalog    
import warnings
import httpx
import shap 

warnings.filterwarnings('ignore')

app = FastAPI(title="ToxiScan AI API", version="1.0")

# Added localhost for local testing, kept Vercel for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://toxi-scan-ai-bychaitanya.vercel.app"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 1. GLOBALS
# ==========================================
model = None
scaler = None
imputer = None 
meta = None
thresholds = None
calibrators = {}  
morgan_gen = None
descriptor_names = None
safe_smiles_shield = set()
hazard_catalog = None 
kb_df = None
db_fps = None
db_smiles = None
db_fp_sums = None 

explainer = None
exact_features = None

CUSTOM_ELECTRO_COLS = {'Elec_MaxCharge', 'Elec_MinCharge', 'Elec_ChargeDensity'}

DEFAULT_THRESHOLDS = {
    "Hepatotoxic": 0.45, "Cardiotoxicity": 0.45, "Respiratory_toxicity": 0.55,
    "BBBP_toxicity": 0.55, "Mutagenicity": 0.45, "Eye Irritation": 0.55,
    "Carcinogenicity": 0.50, "CYP450_CYP1A2": 0.55, "CYP450_CYP2C9": 0.60,
    "CYP450_CYP2C19": 0.50, "CYP450_CYP2D6": 0.65, "CYP450_CYP3A4": 0.60
}

HAZARD_INFO = {
    "Hepatotoxic": {"title": "Liver Toxicity", "description": "The liver is the body's primary filtration system. This compound has chemical features that can overwhelm or damage liver cells during detoxification.", "impact": "May cause acute liver inflammation, impaired metabolic function, or long-term liver damage."},
    "Cardiotoxicity": {"title": "Cardiac Toxicity", "description": "This molecule contains structures known to interfere with the electrical signals or muscle fibers of the human heart.", "impact": "Can lead to irregular heartbeats (arrhythmias), changes in blood pressure, or cardiac muscle stress."},
    "Respiratory_toxicity": {"title": "Respiratory Hazard", "description": "The reactive nature of this compound makes it highly irritating to the delicate mucosal membranes of the lungs and throat.", "impact": "Inhalation may cause immediate breathing difficulties, tissue inflammation, or severe airway damage."},
    "BBBP_toxicity": {"title": "Blood-Brain Barrier Penetration", "description": "The human brain has a strict biological security shield. This molecule's specific size and fat-solubility allow it to sneak past that shield directly into the brain.", "impact": "High risk of unintended neurological effects, dizziness, or central nervous system toxicity."},
    "Mutagenicity": {"title": "Genetic Mutagen", "description": "This chemical is structurally prone to binding directly with human DNA sequences, causing errors when cells attempt to copy their genetic code.", "impact": "Increases the risk of permanent genetic defects and cellular mutations."},
    "Carcinogenicity": {"title": "Carcinogenic Potential", "description": "Based on its structural similarity to known cancer-causing agents, this molecule has a high potential to trigger uncontrolled cellular growth.", "impact": "Long-term exposure is heavily linked to tumor development and cancer."},
    # "Eye Irritation": {"title": "Eye Irritant", "description": "This compound acts as a mild to moderate irritant to ocular tissues, similar to airborne pollutants or harsh soaps.", "impact": "Causes temporary redness, stinging, watering, and discomfort."},
    "CYP450_CYP1A2": {"title": "Enzyme Interference (CYP1A2)", "description": "Jams the CYP1A2 enzyme, which the body uses to break down everyday drugs like caffeine and certain antidepressants.", "impact": "Can cause other medications in your system to build up to toxic levels."},
    "CYP450_CYP2C9": {"title": "Enzyme Interference (CYP2C9)", "description": "Interferes with the CYP2C9 enzyme, critical for processing blood thinners (like warfarin) and NSAID painkillers.", "impact": "High risk of adverse drug interactions and internal bleeding risks."},
    "CYP450_CYP2C19": {"title": "Enzyme Interference (CYP2C19)", "description": "Alters the activity of CYP2C19, an enzyme responsible for processing anti-ulcer medications and anti-seizure drugs.", "impact": "May lead to drug toxicity or render specific medications completely ineffective."},
    "CYP450_CYP2D6": {"title": "Enzyme Interference (CYD2D6)", "description": "Affects CYP2D6, a crucial enzyme responsible for metabolizing nearly 25% of all prescription drugs.", "impact": "Severe risk of multi-drug interactions, particularly with psychiatric and cardiovascular medications."},
    "CYP450_CYP3A4": {"title": "Enzyme Interference (CYP3A4)", "description": "Interferes with CYP3A4, the most abundant metabolic enzyme in the liver that handles over 50% of all clinical drugs.", "impact": "Can lead to catastrophic drug-drug interactions and systemic toxicity."}
}

INORGANIC_ALERTS = {
    "Hg": {"title": "Systemic Heavy Metal Hazard", "desc": "Mercury binds irreversibly to thiol groups in proteins, disrupting cell membrane integrity.", "endpoint": "Neurotoxicity"},
    "Pb": {"title": "Systemic Heavy Metal Hazard", "desc": "Lead mimics calcium, crossing the blood-brain barrier and causing severe neurological degradation.", "endpoint": "Neurotoxicity"},
    "Cd": {"title": "Severe Nephrotoxin & Carcinogen", "desc": "Cadmium accumulates in the kidneys and disrupts cellular DNA repair mechanisms.", "endpoint": "Carcinogenicity"},
    "As": {"title": "Systemic Poison", "desc": "Arsenic disrupts ATP production and cellular respiration, leading to multi-organ failure.", "endpoint": "Carcinogenicity"},
    "Pt": {"title": "DNA Cross-linking Agent", "desc": "Platinum complexes act as potent agents that bind directly to DNA bases, halting cell division.", "endpoint": "Mutagenicity"}
}

CHEMICAL_NAME_CACHE = {}




def get_margin_multiplier(endpoint: str) -> float:
    """
    Returns a percentage multiplier to create the 'UNCERTAIN' zone.
    Harder endpoints get a wider relative uncertainty band.
    """
    hard_endpoints = {"Carcinogenicity", "CYP450_CYP2D6", "Hepatotoxicity"}
    medium_endpoints = {"Respiratory_toxicity", "CYP450_CYP2C9", "CYP450_CYP3A4", "CYP450_CYP2C19", "CYP450_CYP1A2"}

    if endpoint in hard_endpoints: 
        return 0.30  # +/- 30% of the threshold
    if endpoint in medium_endpoints: 
        return 0.20  # +/- 20% of the threshold
    return 0.10      # +/- 10% of the threshold
    
def get_risk_tag(prob: float, threshold: float, endpoint: str) -> str:
    """
    Converts calibrated probability into: SAFE / UNCERTAIN / RISK
    Optimized: Uses dynamic, proportional scaling based on the specific threshold.
    """
    # Safety clamp to ensure clean math
    threshold = min(max(threshold, 0.05), 0.95)
    prob = min(max(prob, 0.0), 1.0)

    # Get the multiplier and calculate the actual dynamic margin
    multiplier = get_margin_multiplier(endpoint)
    actual_margin = threshold * multiplier

    # Define decision boundaries mathematically tied to the threshold
    lower_bound = threshold - actual_margin
    upper_bound = threshold + actual_margin

    # Classification logic
    if prob < lower_bound:
        return "SAFE"
    elif prob <= upper_bound:
        return "UNCERTAIN"
    else:
        return "RISK"

def get_dark_mode_palette():
    white = (0.85, 0.85, 0.85)
    return {1: white, 6: white, 7: white, 8: white, 9: white, 15: white, 16: white, 17: white, 35: white, 53: white}

def check_inorganic_alerts(mol):
    for atom in mol.GetAtoms():
        symbol = atom.GetSymbol()
        if symbol in INORGANIC_ALERTS:
            alert = INORGANIC_ALERTS[symbol]
            return {
                "status": "HAZARDOUS", "safety_level": "Extreme Risk",
                "message": f"Structural Alert: {symbol} (Heavy Metal) complex detected. ML inference bypassed.",
                "flags_detected": 1,
                "hazards": [{
                    "endpoint": alert["endpoint"], "title": alert["title"],
                    "confidence": 1.0, "risk_level": "RISK", "description": alert["desc"],
                    "impact": "High risk of severe acute or chronic toxicity. Requires strict biohazard handling."
                }],
                "metal_atom_idx": atom.GetIdx()  
            }
    return None

def generate_molecule_svg(mol, is_hazardous, explicit_highlights=None):
    drawer = rdMolDraw2D.MolDraw2DSVG(400, 350)
    opts = drawer.drawOptions()
    opts.clearBackground = False 
    opts.updateAtomPalette(get_dark_mode_palette()) 
    opts.bondLineWidth = 2 
    opts.setHighlightColour((1.0, 0.2, 0.2, 0.6)) 
    
    highlight_atoms = set()
    if explicit_highlights: highlight_atoms.update(explicit_highlights)
    
    if is_hazardous and hazard_catalog is not None:
        try:
            matches = hazard_catalog.GetMatches(mol)
            for match in matches:
                for filter_match in match.GetFilterMatches(mol):
                    if hasattr(filter_match, 'atomPairs'):
                        for query_idx, target_idx in filter_match.atomPairs: highlight_atoms.add(target_idx)
        except Exception:
            pass
                
    highlight_list = list(highlight_atoms)
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol, highlightAtoms=highlight_list)
    drawer.FinishDrawing()
    svg_str = drawer.GetDrawingText()
    
    if "<?xml" in svg_str: svg_str = svg_str.split("?>\n")[-1]
    return svg_str, highlight_list

def auto_build_memory_map():
    bin_path = 'Model/db_fps.bin'
    if not os.path.exists(bin_path):
        print("⚙️ Formatting Zero-RAM Binary Database Map (db_fps.bin)...")
        full_df = pd.read_parquet('Model/fingerprint_knowledge_base.parquet')
        fp_cols = [col for col in full_df.columns if col.startswith('FP_')]
        fp_matrix = full_df[fp_cols].values.astype(np.float32)
        fp_matrix.tofile(bin_path)
        del full_df, fp_matrix
        gc.collect()

def extract_pipeline_features(mol):
    fp = morgan_gen.GetFingerprintAsNumPy(mol)
    fp_df = pd.DataFrame([fp], columns=[f"FP_{i}" for i in range(2048)])[meta['fingerprints_cols']]

    has_charges = any(c in meta['desc_cols'] for c in CUSTOM_ELECTRO_COLS)
    if has_charges:
        try:
            AllChem.ComputeGasteigerCharges(mol)
            charges = []
            for atom in mol.GetAtoms():
                if atom.HasProp('_GasteigerCharge'):
                    val = atom.GetProp('_GasteigerCharge')
                    try:
                        charge = float(val)
                        if not np.isnan(charge) and not np.isinf(charge):
                            charges.append(charge)
                    except ValueError:
                        pass
            
            if len(charges) > 0:
                max_c = float(np.max(charges))
                min_c = float(np.min(charges))
                num_heavy_atoms = mol.GetNumHeavyAtoms()
                charge_density = (max_c - min_c) / num_heavy_atoms if num_heavy_atoms > 0 else 0.0
            else:
                max_c, min_c, charge_density = 0.0, 0.0, 0.0
        except Exception:
            max_c, min_c, charge_density = 0.0, 0.0, 0.0
    else:
        max_c, min_c, charge_density = 0.0, 0.0, 0.0

    desc_dict = {}
    for name in meta['desc_cols']:
        if name == 'Elec_MaxCharge': desc_dict[name] = max_c
        elif name == 'Elec_MinCharge': desc_dict[name] = min_c
        elif name == 'Elec_ChargeDensity': desc_dict[name] = charge_density
        else:
            try:
                desc_dict[name] = getattr(Descriptors, name)(mol)
            except Exception:
                desc_dict[name] = 0.0

    desc_df = pd.DataFrame([desc_dict])[meta['desc_cols']]
    desc_df = desc_df.replace([np.inf, -np.inf], [1e6, -1e6]).fillna(0.0)

    for col in meta.get('cols_to_log', []):
        if col in desc_df.columns:
            desc_df[col] = np.log1p(np.maximum(desc_df[col].astype(float), 0))

    desc_df = desc_df.replace([np.inf, -np.inf], np.nan)
    scaled_desc = scaler.transform(desc_df).astype(np.float32)
    X_combined = np.hstack([fp_df.values.astype(np.float32), scaled_desc])
    X_combined[np.isinf(X_combined)] = np.nan
    X_final = imputer.transform(X_combined)

    return X_final


# SERVER STARTUP

@app.on_event("startup")
def load_pipeline():
    global model, scaler, imputer, meta, thresholds, calibrators, morgan_gen, descriptor_names
    global safe_smiles_shield, hazard_catalog, kb_df, db_fps, db_smiles, db_fp_sums
    global explainer, exact_features 

    print("Loading AI pipeline artifacts...")
    with open('Model/pipeline_metadata.json') as f:
        meta = json.load(f)
        exact_features = meta['fingerprints_cols'] + meta['desc_cols'] 
        
    try:
        with open('Model/optimal_thresholds.json') as f: 
            thresholds = json.load(f)
    except Exception:
        thresholds = DEFAULT_THRESHOLDS

    try:
        calibrators = joblib.load('Model/isotonic_calibrators.pkl')
    except Exception:
        pass

    scaler = joblib.load('Model/desc_scaler.pkl')
    imputer = joblib.load('Model/median_imputer.pkl')

    input_size = len(meta['fingerprints_cols']) + len(meta['desc_cols'])
    output_size = len(meta['label_names'])

    model = tf.keras.Sequential([
        tf.keras.layers.Dense(128, activation='relu', input_shape=(input_size,)),
        tf.keras.layers.BatchNormalization(), tf.keras.layers.Dropout(0.4),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.BatchNormalization(), tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.BatchNormalization(), tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(output_size, activation='sigmoid')
    ])
    model.load_weights('Model/toxicity_model.h5')

    try:
        shap_background = np.load('Model/shap_background.npy')[:70]  
        def predict_wrapper(X): return model(X, training=False).numpy()
        explainer = shap.KernelExplainer(predict_wrapper, shap_background)
    except Exception:
        pass

    try:
        auto_build_memory_map()
        essential_cols = ['SMILES'] + meta['label_names']
        kb_df = pd.read_parquet('Model/fingerprint_knowledge_base.parquet', columns=essential_cols)
        num_compounds = len(kb_df)
        db_fps = np.memmap('Model/db_fps.bin', dtype='float32', mode='r', shape=(num_compounds, 2048))
        db_fp_sums = np.sum(db_fps, axis=1)
    except Exception:
        pass

    morgan_gen = GetMorganGenerator(radius=2, fpSize=2048)
    descriptor_names = [d[0] for d in Descriptors._descList]
    
    params = FilterCatalog.FilterCatalogParams()
    params.AddCatalog(FilterCatalog.FilterCatalogParams.FilterCatalogs.PAINS)
    params.AddCatalog(FilterCatalog.FilterCatalogParams.FilterCatalogs.BRENK)
    params.AddCatalog(FilterCatalog.FilterCatalogParams.FilterCatalogs.NIH)
    hazard_catalog = FilterCatalog.FilterCatalog(params)
    print("API Ready.")


# API ENDPOINTS

class MoleculeRequest(BaseModel):
    smiles: str

@app.get("/health")
def health_check():
    return {"status": "awake"}

@app.post("/predict")
def predict_toxicity(request: MoleculeRequest):
    smiles = request.smiles.strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None: raise HTTPException(status_code=400, detail="Invalid SMILES string")

    inorganic_flag = check_inorganic_alerts(mol)
    if inorganic_flag:
        metal_idx = inorganic_flag.pop("metal_atom_idx")
        inorganic_flag.update({"smiles": smiles})
        inorganic_flag["molecule_svg"], inorganic_flag["highlight_atoms"] = generate_molecule_svg(mol, True, [metal_idx])
        return inorganic_flag

    if mol.GetNumHeavyAtoms() < 3: raise HTTPException(status_code=400, detail="Molecule too small.")
    
    try:
        X_final = extract_pipeline_features(mol)
        preds = model(X_final, training=False)[0].numpy()
        
        hazards = []
        for j, label in enumerate(meta['label_names']):
            raw_prob = float(preds[j])
            if calibrators and label in calibrators:
                prob = float(calibrators[label].transform([raw_prob])[0])
            else:
                prob = raw_prob
                
            active_threshold = float(thresholds.get(label, 0.5))
            
            # Use the new get_risk_tag function
            risk_level = get_risk_tag(prob, active_threshold, label)
            
            # Only append if it's RISK or UNCERTAIN
            if risk_level in ["RISK", "UNCERTAIN"]:
                info = HAZARD_INFO.get(label, {})
                hazards.append({
                    "endpoint": label, "title": info.get("title", label), "confidence": round(prob, 3),
                    "risk_level": risk_level,
                    "description": info.get("description", ""),
                    "impact": info.get("impact", "")
                })

        hazards = sorted(hazards, key=lambda x: x['confidence'], reverse=True)
        svg_str, hl_atoms = generate_molecule_svg(mol, is_hazardous=bool(hazards))

        return {
            "smiles": smiles, 
            "status": "EVALUATED" if hazards else "SAFE", "safety_level": "High Risk" if hazards else "Screened",
            "message": f"AI detected {len(hazards)} total hazard flags." if hazards else "No hazards detected.",
            "flags_detected": len(hazards), "hazards": hazards, "molecule_svg": svg_str,
            "highlight_atoms": hl_atoms
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")

@app.post("/explain")
def explain_toxicity(request: MoleculeRequest):
    smiles = request.smiles.strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None: raise HTTPException(status_code=400, detail="Invalid SMILES")

    try:
        X_final = extract_pipeline_features(mol)
        preds = model(X_final, training=False)[0].numpy()
        
        active_hazards = []
        for j, label in enumerate(meta['label_names']):
            raw_prob = float(preds[j])
            prob = float(calibrators[label].transform([raw_prob])[0]) if (calibrators and label in calibrators) else raw_prob
            
            active_threshold = float(thresholds.get(label, 0.5))
            risk_level = get_risk_tag(prob, active_threshold, label)
            
            # Explain both RISK and UNCERTAIN targets
            if risk_level in ["RISK", "UNCERTAIN"]:
                active_hazards.append(label)

        shap_explanation = []
        if active_hazards and explainer is not None:
            sv = explainer.shap_values(X_final, silent=True) 
            for hazard_label in active_hazards:
                label_idx = meta['label_names'].index(hazard_label)
                feature_attributions = sv[label_idx][0] if isinstance(sv, list) else (sv[0, :, label_idx] if sv.ndim == 3 else sv[0])
                top_indices = np.argsort(np.abs(feature_attributions))[-3:][::-1]
                top_features = [{"feature": exact_features[idx], "contribution": round(float(feature_attributions[idx]), 4), "direction": "up" if float(feature_attributions[idx]) >= 0 else "down"} for idx in top_indices if abs(float(feature_attributions[idx])) > 0.0001]
                if top_features: shap_explanation.append({"endpoint": hazard_label, "top_drivers": top_features})

        return {"shap_explanation": shap_explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SHAP Runtime Error: {str(e)}")

@app.post("/similarity")
def find_similar(request: MoleculeRequest):
    smiles = request.smiles.strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None: raise HTTPException(status_code=400, detail="Invalid SMILES")

    similar_compounds = []
    if db_fps is not None and db_fp_sums is not None:
        try:
            fp = morgan_gen.GetFingerprintAsNumPy(mol)
            query_fp = fp.reshape(1, -1).astype(np.float32)
            
            intersection = np.dot(db_fps, query_fp.T).flatten()
            sum_query = np.sum(query_fp)
            tanimoto_scores = intersection / (db_fp_sums + sum_query - intersection)
            
            top_5_idx = np.argsort(tanimoto_scores)[-5:][::-1]
            for idx in top_5_idx:
                row = kb_df.iloc[idx]
                active_hazards = [l for l in meta['label_names'] if row.get(l, 0) == 1.0]
                similar_compounds.append({
                    "smiles": str(row['SMILES']),
                    "similarity_score": float(round(tanimoto_scores[idx], 3)),
                    "known_hazards": active_hazards
                })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Tanimoto Search Failed: {str(e)}")

    return {"similar_compounds": similar_compounds}

@app.post("/identity")
def get_identity(request: MoleculeRequest):
    smiles = request.smiles.strip()
    if smiles in CHEMICAL_NAME_CACHE: return CHEMICAL_NAME_CACHE[smiles]

    default_identity = {"common_name": "Novel Derivative", "iupac_name": "Unavailable"}
    encoded_smiles = urllib.parse.quote(smiles)
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/{encoded_smiles}/property/IUPACName,Title/JSON"
    
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(url)
            if response.status_code == 200:
                data = response.json()
                props = data["PropertyTable"]["Properties"][0]
                raw_title = str(props.get("Title", "Novel Derivative"))
                common = "Novel Derivative" if raw_title.isdigit() else raw_title
                iupac = props.get("IUPACName", "Unavailable")
                result = {"common_name": common, "iupac_name": iupac}
                CHEMICAL_NAME_CACHE[smiles] = result
                return result
            else:
                return default_identity
    except Exception:
        return default_identity
