import json
from rdkit.Chem import Descriptors

#  Create an empty dictionary
rdkit_dictionary = {}

#  Loop through every single descriptor built into RDKit
for name, func in Descriptors.descList:
    # Extract RDKit's official internal documentation string
    raw_doc = func.__doc__
    
    # Clean it up (grab just the first sentence so it fits in the UI)
    if raw_doc:
        clean_doc = raw_doc.strip().split('\n')[0]
    else:
        clean_doc = "RDKit calculated physicochemical descriptor."
        
    rdkit_dictionary[name] = {"desc": clean_doc}

#  Add our 3 Custom Electrostatic features
rdkit_dictionary["Elec_MaxCharge"] = {"desc": "The most positive electrical partial charge found on a single atom."}
rdkit_dictionary["Elec_MinCharge"] = {"desc": "The most negative electrical partial charge found on a single atom."}
rdkit_dictionary["Elec_ChargeDensity"] = {"desc": "The span of electrical charge spread across the heavy atoms."}

#  Save it as a JSON file
with open('rdkit_dictionary.json', 'w') as f:
    json.dump(rdkit_dictionary, f, indent=4)

print(f"Successfully mapped {len(rdkit_dictionary)} features to rdkit_dictionary.json!")